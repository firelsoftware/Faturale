"""API em JSON que as telas (static/faturamento/app.js) usam."""
import json
import re
import secrets
import time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.core.files import File
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Q, Sum
from django.db.models.deletion import ProtectedError
from django.db.models.functions import TruncMonth, TruncYear
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie

from .extrator import extrair_lote, ler_protocolo_xml
from .management.commands.semear import normalizar
from .models import Convenio, EntregaCalendario, EnvioXml, Feriado, Lote, Mensagem, Usuario


# ---------- Utilidades ----------
def erro(msg, status=400):
    return JsonResponse({'erro': msg}, status=status)


def api(aba=None, metodos=('GET',), com_senha_provisoria=False):
    """Exige login (e a aba, se houver), confere o método e lê o corpo JSON em request.dados.
    Quem está com a senha inicial só usa o que serve para trocá-la."""
    def deco(fn):
        @wraps(fn)
        def inner(request, *a, **kw):
            if request.method not in metodos:
                return erro('Método não permitido.', 405)
            if not request.user.is_authenticated or not request.user.is_active:
                return erro('Faça login.', 401)
            if precisa_trocar(request.user) and not com_senha_provisoria:
                return JsonResponse({'erro': 'Troque sua senha para continuar.', 'trocarSenha': True}, status=428)
            if aba and not request.user.pode(aba):
                return erro('Sem acesso.', 403)
            request.dados = {}
            if request.content_type == 'application/json' and request.body:
                try:
                    request.dados = json.loads(request.body)
                except ValueError:
                    return erro('JSON inválido.')
            return fn(request, *a, **kw)
        return inner
    return deco


def precisa_trocar(u):
    return u.trocar_senha and not settings.FATURALE_MODO_DEMO


def iso(d):
    return d.isoformat() if d else None


def para_data(txt):
    try:
        return date.fromisoformat(txt) if txt else None
    except ValueError:
        return None


def hoje():
    return date.today()


PASTA_PENDENTES = Path(settings.MEDIA_ROOT) / 'pendentes'
EXTENSOES = {'.pdf', '.xml', '.png', '.jpg', '.jpeg'}


def guardar_pendente(arquivo):
    """Guarda o arquivo enviado até a pessoa confirmar os dados. Apaga os abandonados há mais de 2 h."""
    PASTA_PENDENTES.mkdir(parents=True, exist_ok=True)
    for velho in PASTA_PENDENTES.iterdir():
        if time.time() - velho.stat().st_mtime > 7200:
            velho.unlink(missing_ok=True)
    ext = Path(arquivo.name).suffix.lower()
    token = secrets.token_hex(12)
    dados = arquivo.read()
    (PASTA_PENDENTES / f'{token}{ext}').write_bytes(dados)
    return token, dados


def pegar_pendente(token):
    if not token or not re.fullmatch(r'[0-9a-f]{24}', token):
        return None
    return next(PASTA_PENDENTES.glob(f'{token}.*'), None) if PASTA_PENDENTES.exists() else None


def anexar(campo, nome, caminho):
    with open(caminho, 'rb') as f:
        campo.save(nome, File(f), save=True)
    caminho.unlink(missing_ok=True)


# ---------- Páginas ----------
@ensure_csrf_cookie
def inicio(request):
    return render(request, 'faturamento/index.html')


def perfil_json(u):
    return {'id': u.id, 'nome': u.nome, 'login': u.username, 'perfil': u.perfil, 'abas': u.abas,
            'modoDemo': settings.FATURALE_MODO_DEMO, 'regraGuias': settings.FATURALE_REGRA_GUIAS,
            'trocarSenha': precisa_trocar(u), 'funcao': u.funcao}


# ---------- Entrar / sair ----------
def entrar_pessoas(request):
    """Quem aparece na tela de entrada. Fora do modo demonstração, clicar na pessoa pede a senha."""
    pessoas = Usuario.objects.filter(is_active=True).order_by('id')
    sem_senha = settings.FATURALE_MODO_DEMO
    return JsonResponse([{'nome': u.nome, 'login': u.username, 'perfil': u.perfil, 'semSenha': sem_senha} for u in pessoas], safe=False)


def entrar(request):
    if request.method != 'POST':
        return erro('Método não permitido.', 405)
    dados = json.loads(request.body or '{}')
    if settings.FATURALE_MODO_DEMO:
        u = Usuario.objects.filter(username=dados.get('login', ''), is_active=True).first()
    else:
        u = authenticate(request, username=str(dados.get('login', '')).strip().lower(), password=dados.get('senha', ''))
    if not u:
        return erro('Usuário ou senha inválidos.', 401)
    login(request, u, backend='django.contrib.auth.backends.ModelBackend')
    return JsonResponse(perfil_json(u))


def sair(request):
    logout(request)
    return JsonResponse({'ok': True})


@api(com_senha_provisoria=True)
def eu(request):
    return JsonResponse(perfil_json(request.user))


@api(None, ('POST',), com_senha_provisoria=True)
def trocar_senha(request):
    """Troca a própria senha. Obrigatório no primeiro acesso (senha inicial)."""
    u, d = request.user, request.dados
    atual, nova = str(d.get('atual') or ''), str(d.get('nova') or '')
    if not u.check_password(atual):
        return erro('A senha atual não confere.')
    if len(nova) < 6:
        return erro('A senha nova precisa de pelo menos 6 caracteres.')
    if nova == atual or nova == settings.FATURALE_SENHA_INICIAL:
        return erro('Escolha uma senha diferente da atual e da senha inicial.')
    if nova != str(d.get('confirmacao') or ''):
        return erro('A confirmação não é igual à senha nova.')
    u.set_password(nova)
    u.trocar_senha = False
    u.save()
    update_session_auth_hash(request, u)
    return JsonResponse(perfil_json(u))


# ---------- Pessoas ----------
@api()
def pessoas(request):
    qs = Usuario.objects.filter(is_active=True).order_by('first_name')
    return JsonResponse([{'id': u.id, 'nome': u.nome, 'perfil': u.perfil, 'funcao': u.funcao,
                          'fatura': u.faz_faturamento, 'xml': u.faz_xml} for u in qs], safe=False)


def usuario_json(u):
    return {'id': u.id, 'nome': u.nome, 'login': u.username, 'perfil': u.perfil, 'ativo': u.is_active,
            'criado_em': u.date_joined.date().isoformat(), 'trocar_senha': u.trocar_senha, 'funcao': u.funcao}


def perfis_que_pode_criar(u):
    return [p.value for p in Usuario.Perfil] if u.perfil == 'diretor' else ['faturista']


@api('gestao', ('GET', 'POST'))
def usuarios(request):
    if request.method == 'GET':
        return JsonResponse([usuario_json(u) for u in Usuario.objects.order_by('first_name')], safe=False)
    d = request.dados
    if d.get('perfil') not in perfis_que_pode_criar(request.user):
        return erro('Você não pode criar esse perfil.', 403)
    nome, login_ = str(d.get('nome', '')).strip(), str(d.get('login', '')).strip().lower()
    if not nome or not re.fullmatch(r'[a-z0-9._-]{2,30}', login_):
        return erro('Preencha nome e login (letras minúsculas, números, ponto).')
    if Usuario.objects.filter(username=login_).exists():
        return erro('Login já existe.', 409)
    funcao = d.get('funcao') if d.get('funcao') in ('faturamento', 'xml', 'ambos') else 'ambos'
    u = Usuario(username=login_, first_name=nome, perfil=d['perfil'], trocar_senha=True, funcao=funcao)
    u.set_password(settings.FATURALE_SENHA_INICIAL)  # a pessoa troca no primeiro acesso
    u.save()
    return JsonResponse({'id': u.id})


@api('gestao', ('PUT',))
def usuario(request, pk):
    alvo = Usuario.objects.filter(pk=pk).first()
    if not alvo:
        return erro('Não encontrado.', 404)
    d = request.dados
    permitidos = perfis_que_pode_criar(request.user)
    if alvo.perfil not in permitidos or d.get('perfil') not in permitidos:
        return erro('Você não pode alterar esse usuário.', 403)
    if alvo == request.user and not d.get('ativo'):
        return erro('Você não pode desativar a si mesmo.')
    alvo.first_name = str(d.get('nome', alvo.first_name)).strip()
    alvo.perfil = d['perfil']
    if d.get('funcao') in ('faturamento', 'xml', 'ambos'):
        alvo.funcao = d['funcao']
    alvo.is_active = bool(d.get('ativo'))
    if d.get('redefinir'):
        alvo.set_password(settings.FATURALE_SENHA_INICIAL)
        alvo.trocar_senha = True
    alvo.save()
    if d.get('redefinir') and alvo != request.user:
        from django.contrib.sessions.models import Session
        for sess in Session.objects.all():  # derruba o acesso aberto dessa pessoa
            if str(sess.get_decoded().get('_auth_user_id')) == str(alvo.id):
                sess.delete()
    return JsonResponse({'ok': True})


# ---------- Convênios ----------
def feriados_do_mes(dia=None):
    dia = dia or hoje()
    return set(Feriado.objects.filter(data__year=dia.year, data__month=dia.month).values_list('data', flat=True))


def aberto_hoje(c, feriados=None):
    return c.aberto_em(hoje(), feriados_do_mes() if feriados is None else feriados)


def convenio_json(c, feriados=None):
    return {
        'id': c.id, 'nome': c.nome, 'codigo': c.codigo, 'ativo': c.ativo, 'tem_xml': c.tem_xml,
        'faturista_id': c.faturista_id, 'faturista': c.faturista.nome if c.faturista else None,
        'xml_id': c.responsavel_xml_id, 'responsavel_xml': c.responsavel_xml.nome if c.responsavel_xml else None,
        'prazo_texto': c.prazo_texto, 'prazo_tipo': c.prazo_tipo, 'prazo_inicio': c.prazo_inicio, 'prazo_fim': c.prazo_fim,
        'prazo_dias': c.dias_lista, 'prazo_dia_util': c.prazo_dia_util, 'prazo_hora': c.prazo_hora,
        'aberto_hoje': aberto_hoje(c, feriados),
    }


def aplicar_prazo(c, p):
    """p = {tipo, inicio, fim, dias, dia_util, hora, livre}, vindo da janela "Editar prazo"."""
    from .prazos import ler_dias
    tipo = p.get('tipo')
    dia = lambda v: int(v) if str(v or '').isdigit() and 1 <= int(v) <= 31 else None
    if tipo == 'intervalo':
        ini, fim = dia(p.get('inicio')), dia(p.get('fim'))
        if not ini or not fim or ini > fim:
            raise ValueError('Informe "de" e "até" (dias de 1 a 31, o primeiro menor).')
        c.definir_prazo('intervalo', inicio=ini, fim=fim, hora=p.get('hora', ''))
    elif tipo == 'dias':
        dias = ler_dias(p.get('dias'))
        if not dias:
            raise ValueError('Informe os dias (ex.: 9 e 27).')
        c.definir_prazo('dias', dias=dias, hora=p.get('hora', ''))
    elif tipo == 'dia_util':
        n = dia(p.get('dia_util'))
        if not n or n > 23:
            raise ValueError('Informe até qual dia útil (1 a 23).')
        c.definir_prazo('dia_util', dia_util=n, hora=p.get('hora', ''))
    else:
        c.definir_prazo('livre', livre=str(p.get('livre') or '')[:80])


def aplicar_convenio(c, d):
    """Atualiza só os campos que vieram (a tela de distribuição manda um campo por vez)."""
    if 'nome' in d:
        if not str(d['nome']).strip():
            raise ValueError('Informe o nome.')
        c.nome = str(d['nome']).strip()
    if 'codigo' in d:
        c.codigo = str(d['codigo'] or '').strip() or None
    for campo in ('ativo', 'tem_xml'):
        if campo in d:
            setattr(c, campo, bool(d[campo]))
    if 'faturista_id' in d:
        c.faturista_id = d['faturista_id'] or None
    if 'xml_id' in d:
        c.responsavel_xml_id = d['xml_id'] or None
    if isinstance(d.get('prazo'), dict):
        aplicar_prazo(c, d['prazo'])


@api(None, ('GET', 'POST'))
def convenios(request):
    if request.method == 'GET':
        qs = sorted(Convenio.objects.select_related('faturista', 'responsavel_xml'), key=lambda c: normalizar(c.nome))
        feriados = feriados_do_mes()
        return JsonResponse([convenio_json(c, feriados) for c in qs], safe=False)
    if not request.user.pode('coordenacao'):
        return erro('Sem acesso.', 403)
    c = Convenio()
    try:
        aplicar_convenio(c, {'nome': '', **request.dados})
        c.save()
    except ValueError as e:
        return erro(str(e))
    except IntegrityError:
        return erro('Já existe convênio com esse código.', 409)
    return JsonResponse(convenio_json(c))


@api('gestao', ('PUT', 'DELETE'))
def convenio(request, pk):
    c = Convenio.objects.filter(pk=pk).first()
    if not c:
        return erro('Não encontrado.', 404)
    # Supervisão e coordenação mudam o prazo do portal; o resto do convênio é com a coordenação.
    so_prazo = request.method == 'PUT' and set(request.dados) <= {'prazo'}
    if not so_prazo and not request.user.pode('coordenacao'):
        return erro('Só a coordenação muda isso. A supervisão pode mudar o prazo do portal.', 403)
    if request.method == 'DELETE':
        try:
            c.delete()
        except ProtectedError:
            return erro('Esse convênio já tem lotes ou envios. Desative em vez de excluir.', 409)
        return JsonResponse({'ok': True})
    try:
        aplicar_convenio(c, request.dados)
        c.save()
    except ValueError as e:
        return erro(str(e))
    except IntegrityError:
        return erro('Já existe convênio com esse código.', 409)
    c.refresh_from_db()
    return JsonResponse(convenio_json(Convenio.objects.select_related('faturista', 'responsavel_xml').get(pk=c.pk)))


# ---------- Lotes ----------
def com_envio():
    return Exists(EnvioXml.objects.filter(lote=OuterRef('pk')))


def filtro_lotes(request):
    q, u = request.GET, request.user
    qs = Lote.objects.select_related('convenio', 'faturista', 'lancado_por')
    if not u.ve_todos:
        # A faturista vê a própria produção; ?meus=1 inclui o que ela lançou para outra pessoa
        qs = qs.filter(faturista=u)  # só a própria produção
    elif q.get('faturista'):
        qs = qs.filter(faturista_id=q['faturista'])
    if q.get('convenio'):
        qs = qs.filter(convenio_id=q['convenio'])
    if q.get('competencia'):
        qs = qs.filter(competencia=q['competencia'])
    if para_data(q.get('inicio')):
        qs = qs.filter(data_lancamento__gte=q['inicio'])
    if para_data(q.get('fim')):
        qs = qs.filter(data_lancamento__lte=q['fim'])
    if q.get('status'):
        qs = qs.filter(status=q['status'])
    if q.get('busca'):
        qs = qs.filter(numero_lote__icontains=q['busca'])
    xml = q.get('xml')
    if xml == 'na':
        qs = qs.filter(convenio__tem_xml=False)
    elif xml == 'enviado':
        qs = qs.filter(com_envio(), convenio__tem_xml=True)
    elif xml == 'pendente':
        qs = qs.filter(~com_envio(), convenio__tem_xml=True)
    return qs


def divergencia(lote):
    """Valor do protocolo do convênio quando é diferente do valor do lote (último envio com valor). Senão None."""
    envios = [e for e in lote.envios_xml.all() if e.valor_protocolo is not None]
    if not envios:
        return None
    e = max(envios, key=lambda x: (x.data_envio, x.id))
    return e.valor_protocolo if abs(e.valor_protocolo - lote.valor_total) >= Decimal('0.01') else None


def lote_json(l):
    if not l.convenio.tem_xml:
        xml = 'na'
    else:
        xml = 'enviado' if getattr(l, 'tem_envio', False) else 'pendente'
    return {
        'id': l.id, 'numero_lote': l.numero_lote, 'convenio_id': l.convenio_id, 'convenio': l.convenio.nome,
        'faturista_id': l.faturista_id, 'faturista': l.faturista.nome, 'qtd_guias': l.qtd_guias,
        'guias_texto': l.guias_texto, 'valor_total': float(l.valor_total), 'competencia': l.competencia,
        'periodo_inicio': iso(l.periodo_inicio), 'periodo_fim': iso(l.periodo_fim), 'tipo': l.tipo,
        'prestador': l.prestador, 'status': l.status, 'observacao': l.observacao, 'arquivo': bool(l.arquivo),
        'data_lancamento': iso(l.data_lancamento), 'demo': l.demo, 'xml': xml,
        'gerado_por': l.gerado_por, 'lancado_por': l.lancado_por.nome if l.lancado_por else None,
        'valor_convenio': float(v) if (v := divergencia(l)) is not None else None,
    }


def achar_pessoa(texto):
    """'emmily.trindade' → Emmily; 'Larissa' → Larissa. Compara com nome e login de quem está ativo."""
    chaves = {normalizar(texto), normalizar(str(texto).split('.')[0])} - {''}
    for u in Usuario.objects.filter(is_active=True):
        if chaves & {normalizar(u.first_name), normalizar(u.username), normalizar(u.username.split('.')[0])}:
            return u
    return None


def quem_gerou(d):
    """Regra: vale o login do rodapé, a não ser que haja um nome colado no protocolo lá em cima
    ("365118Larissa"). "361843-BRADESCO" é o convênio, não pessoa.
    Devolve (texto lido, de onde veio, usuário da equipe ou None)."""
    sufixo, rodape = d.get('sufixoProtocolo') or '', d.get('usuarioRodape') or ''
    if sufixo:
        pessoa = achar_pessoa(sufixo)
        parece_convenio = d.get('sufixoComHifen') or achar_convenio(sufixo, None) or \
            normalizar(sufixo) in normalizar(d.get('convenioNome'))
        if pessoa or not parece_convenio:
            return sufixo, 'topo', pessoa
    if rodape:
        return rodape, 'rodapé', achar_pessoa(rodape)
    return '', '', None


@api(None, ('POST',))
def lotes_extrair(request):
    arquivo = request.FILES.get('pdf')
    if not arquivo:
        return erro('Envie o PDF ou a foto do protocolo.')
    if Path(arquivo.name).suffix.lower() not in {'.pdf', '.png', '.jpg', '.jpeg'}:
        return erro('Envie PDF ou foto (PNG/JPG).')
    token, dados = guardar_pendente(arquivo)
    try:
        d = extrair_lote(dados, arquivo.name)
    except Exception:
        return erro('Não consegui ler esse arquivo. Preencha os dados à mão.', 422)
    if d['leitura'] == 'ocr':
        d['avisos'].insert(0, 'Lido por OCR (arquivo escaneado ou foto). Confira os números antes de salvar.')
    gerado, origem, pessoa = quem_gerou(d)
    d.update(geradoPor=gerado, geradoPorOrigem=origem, faturistaId=pessoa.id if pessoa else None,
             faturistaNome=pessoa.nome if pessoa else None)
    if gerado and not pessoa:
        d['avisos'].append(f'"{gerado}" (quem gerou, no {origem}) não está cadastrado na equipe. Escolha o faturista.')
    c = achar_convenio(d['convenioNome'], d['convenioCodigo'])
    if c and Lote.objects.filter(numero_lote=d['numeroLote'], convenio=c).exists():
        d['avisos'].append('Este lote já foi lançado para este convênio.')
    if c and EnvioXml.objects.filter(numero_lote=d['numeroLote'], convenio=c, lote__isnull=True).exists():
        d['avisos'].append('O XML deste lote já foi enviado: o protocolo será amarrado ao salvar.')
    return JsonResponse({**d, 'arquivoId': token, 'convenioId': c.id if c else None, 'nomeArquivo': arquivo.name})


def achar_convenio(nome, codigo):
    if codigo:
        c = Convenio.objects.filter(codigo=codigo).first()
        if c:
            return c
    alvo = normalizar(nome)
    return next((c for c in Convenio.objects.all() if alvo and normalizar(c.nome) == alvo), None)


def resolver_convenio(d):
    if d.get('convenioId'):
        return Convenio.objects.filter(pk=d['convenioId']).first()
    nome = str(d.get('convenioNome') or '').strip()
    if not nome:
        return None
    return achar_convenio(nome, d.get('convenioCodigo')) or Convenio.objects.create(nome=nome, codigo=d.get('convenioCodigo') or None)


def validar_lote(d):
    if not str(d.get('numeroLote', '')).strip():
        return 'Informe o número do lote.'
    try:
        if int(d.get('qtdGuias') or 0) <= 0:
            return 'Quantidade de guias inválida.'
        if Decimal(str(d.get('valorTotal'))) < 0:
            return 'Valor inválido.'
    except (ValueError, InvalidOperation):
        return 'Número inválido.'
    if not re.fullmatch(r'\d{4}-\d{2}', d.get('competencia') or ''):
        return 'Competência inválida (use mês/ano).'
    if not para_data(d.get('dataLancamento')):
        return 'Data de lançamento inválida.'
    return None


def preencher_lote(l, d):
    l.numero_lote = str(d['numeroLote']).strip()
    l.qtd_guias = int(d['qtdGuias'])
    l.valor_total = Decimal(str(d['valorTotal'])).quantize(Decimal('0.01'))
    l.competencia = d['competencia']
    l.data_lancamento = para_data(d['dataLancamento'])
    l.periodo_inicio = para_data(d.get('periodoInicio'))
    l.periodo_fim = para_data(d.get('periodoFim'))
    l.tipo = d.get('tipo') or ''
    l.observacao = d.get('observacao') or ''


@api(None, ('GET', 'POST'))
def lotes(request):
    if request.method == 'GET':
        qs = filtro_lotes(request).annotate(tem_envio=com_envio()).prefetch_related('envios_xml').order_by('-data_lancamento', '-id')[:1000]
        return JsonResponse([lote_json(l) for l in qs], safe=False)
    d, u = request.dados, request.user
    if msg := validar_lote(d):
        return erro(msg)
    c = resolver_convenio(d)
    if not c:
        return erro('Informe o convênio.')
    if Lote.objects.filter(numero_lote=str(d['numeroLote']).strip(), convenio=c).exists():
        return erro('Este lote já foi lançado para este convênio.', 409)
    # A produção vai para quem gerou o protocolo (vem do PDF); sem isso, para quem está lançando.
    faturista_id = d.get('faturistaId') if d.get('faturistaId') and Usuario.objects.filter(pk=d['faturistaId'], is_active=True).exists() else u.id
    l = Lote(convenio=c, guias_texto=d.get('guiasTexto') or '', prestador=d.get('prestador') or '',
             faturista_id=faturista_id, gerado_por=str(d.get('geradoPor') or '')[:80], lancado_por=u)
    preencher_lote(l, d)
    with transaction.atomic():
        l.save()
        amarrados = l.amarrar_envios()
    if caminho := pegar_pendente(d.get('arquivoId')):
        anexar(l.arquivo, f'lote-{l.id}.pdf', caminho)
    return JsonResponse({'id': l.id, 'xmlAmarrados': amarrados})


def lote_do_usuario(request, pk):
    l = Lote.objects.select_related('convenio').filter(pk=pk).first()
    if not l:
        return None, erro('Lote não encontrado.', 404)
    if not request.user.ve_todos and l.faturista_id != request.user.id:
        return None, erro('Sem acesso.', 403)
    return l, None


@api(None, ('PUT', 'DELETE'))
def lote(request, pk):
    l, resp = lote_do_usuario(request, pk)
    if resp:
        return resp
    u = request.user
    if not u.ve_todos and l.status == 'conferido':
        return erro('Lote já conferido. Peça à gestão para alterar.', 403)
    if request.method == 'DELETE':
        if l.arquivo:
            l.arquivo.delete(save=False)
        l.delete()
        return JsonResponse({'ok': True})
    d = request.dados
    if msg := validar_lote(d):
        return erro(msg)
    l.convenio = resolver_convenio(d) or l.convenio
    if d.get('faturistaId') and Usuario.objects.filter(pk=d['faturistaId'], is_active=True).exists():
        l.faturista_id = d['faturistaId']
    preencher_lote(l, d)
    if not u.ve_todos and l.status == 'devolvido':
        l.status = 'lancado'  # faturista corrigiu: volta para a fila de conferência
    try:
        with transaction.atomic():
            l.save()
            amarrados = l.amarrar_envios()
    except IntegrityError:
        return erro('Já existe esse lote para esse convênio.', 409)
    return JsonResponse({'ok': True, 'xmlAmarrados': amarrados})


@api('gestao', ('PATCH',))
def lote_status(request, pk):
    d = request.dados
    if d.get('status') not in Lote.Status.values:
        return erro('Status inválido.')
    l = Lote.objects.filter(pk=pk).first()
    if not l:
        return erro('Lote não encontrado.', 404)
    l.status = d['status']
    if d.get('observacao') is not None:
        l.observacao = d['observacao']
    l.save()
    return JsonResponse({'ok': True})


@api()
def lote_pdf(request, pk):
    l, resp = lote_do_usuario(request, pk)
    if resp:
        return resp
    if not l.arquivo:
        return erro('Lote sem PDF.', 404)
    return FileResponse(l.arquivo.open('rb'), content_type='application/pdf')


@api('gestao', ('DELETE',))
def apagar_demonstracao(request):
    with transaction.atomic():
        envios = EnvioXml.objects.filter(demo=True).delete()[0]
        apagados = Lote.objects.filter(demo=True).delete()[0]
    return JsonResponse({'apagados': apagados, 'envios': envios})


# ---------- XML ----------
def ve_producao(u, lote):
    """Guias e valor de um lote: só a própria faturista, a gestão e a coordenação veem.
    Quem passa o XML de um convênio enxerga o número do lote, mas não a produção de outra pessoa."""
    return bool(lote) and (u.ve_todos or lote.faturista_id == u.id)


def envio_json(e, u):
    mostra = ve_producao(u, e.lote)
    return {
        'id': e.id, 'numero_lote': e.numero_lote, 'convenio_id': e.convenio_id, 'convenio': e.convenio.nome,
        'lote_id': e.lote_id, 'lote_guias': e.lote.qtd_guias if mostra else None,
        'lote_valor': float(e.lote.valor_total) if mostra else None,
        'faturista': e.lote.faturista.nome if e.lote else None,
        'responsavel_id': e.responsavel_id, 'responsavel': e.responsavel.nome, 'protocolo': e.protocolo,
        'data_envio': iso(e.data_envio), 'arquivo': bool(e.arquivo), 'nome_arquivo': e.nome_arquivo,
        'observacao': e.observacao, 'demo': e.demo,
        'valor_protocolo': float(e.valor_protocolo) if e.valor_protocolo is not None else None,
        'divergente': bool(e.lote and e.valor_protocolo is not None and abs(e.valor_protocolo - e.lote.valor_total) >= Decimal('0.01')),
    }


def lotes_sem_xml(request):
    """Lotes já lançados, de convênio com XML, que ainda não têm protocolo de envio."""
    qs = (Lote.objects.select_related('convenio', 'faturista', 'convenio__responsavel_xml')
          .filter(~com_envio(), convenio__tem_xml=True))
    if not request.user.ve_todos:
        qs = qs.filter(convenio__responsavel_xml=request.user)
    elif request.GET.get('responsavel'):
        qs = qs.filter(convenio__responsavel_xml_id=request.GET['responsavel'])
    if request.GET.get('convenio'):
        qs = qs.filter(convenio_id=request.GET['convenio'])
    return qs


def candidato_json(l, u):
    mostra = ve_producao(u, l)
    return {'id': l.id, 'numero_lote': l.numero_lote, 'convenio_id': l.convenio_id, 'convenio': l.convenio.nome,
            'faturista': l.faturista.nome, 'qtd_guias': l.qtd_guias if mostra else None,
            'valor_total': float(l.valor_total) if mostra else None,
            'data_lancamento': iso(l.data_lancamento), 'competencia': l.competencia}


@api(None, ('POST',))
def xml_ler(request):
    arquivo = request.FILES.get('arquivo')
    if not arquivo:
        return erro('Anexe o protocolo.')
    if Path(arquivo.name).suffix.lower() not in EXTENSOES:
        return erro('Envie PDF, XML ou imagem (PNG/JPG).')
    token, dados = guardar_pendente(arquivo)
    try:
        achado = ler_protocolo_xml(dados, arquivo.name)
    except Exception:
        achado = {'tipo': 'outro', 'numeroLote': '', 'convenioNome': '', 'convenioCodigo': '', 'protocolo': '', 'numeros': []}
    avisos = []
    c = achar_convenio(achado['convenioNome'], achado['convenioCodigo'])
    base = Lote.objects.select_related('convenio', 'faturista')
    # Faturista anexando no Faturamento: só procura entre os lotes dela
    do_faturamento = request.GET.get('contexto') == 'faturamento' and not request.user.ve_todos
    if do_faturamento:
        base = base.filter(faturista=request.user)
    candidatos = []
    if achado['numeroLote']:
        qs = base.filter(numero_lote=achado['numeroLote'])
        candidatos = list(qs.filter(convenio=c) if c and qs.filter(convenio=c).exists() else qs)
    if not candidatos and achado['numeros']:
        # Procura no texto algum número de lote que ainda espera XML
        sem_protocolo = (base.filter(~com_envio(), convenio__tem_xml=True) if do_faturamento else lotes_sem_xml(request))
        candidatos = list(sem_protocolo.filter(numero_lote__in=achado['numeros'][:500])[:10])
    # Tudo o que foi lido do arquivo, para mostrar na tela (e lançar o lote, se ainda não existir)
    extraidos = None
    if achado.get('numeroLote'):
        gerado, origem, pessoa = quem_gerou(achado)
        extraidos = {k: achado.get(k) for k in ('numeroLote', 'convenioNome', 'convenioCodigo', 'qtdGuias', 'guiasTexto', 'competencia',
                                                'periodoInicio', 'periodoFim', 'prestador')}
        extraidos.update(tipo=achado.get('tipoProtocolo'), valorTotal=achado.get('valor'), geradoPor=gerado, geradoPorOrigem=origem,
                         faturistaId=pessoa.id if pessoa else None, faturistaNome=pessoa.nome if pessoa else None,
                         convenioId=c.id if c else None)
    nao_lancado = False
    lote_ = candidatos[0] if len(candidatos) == 1 else None
    if lote_:
        c = lote_.convenio
        ja = EnvioXml.objects.filter(lote=lote_).select_related('responsavel').first()
        if ja:
            avisos.append(f'Este lote já tem XML registrado em {ja.data_envio:%d/%m/%Y} por {ja.responsavel.nome}. '
                          'Salvar registra mais um envio.')
    elif achado['numeroLote'] and not candidatos and do_faturamento:
        avisos.append(f'O lote {achado["numeroLote"]} não está entre os seus lançamentos. Lance o lote primeiro '
                      '(ou confira o número). Se salvar assim, o protocolo fica esperando o lote.')
    elif achado['numeroLote'] and not candidatos:
        nao_lancado = True  # não é erro: a tela mostra os dados lidos e oferece lançar o lote
    elif not candidatos:
        avisos.append('Não achei o número do lote no arquivo. Escolha o lote na lista ou digite o número.')
    return JsonResponse({
        'arquivoId': token, 'nomeArquivo': arquivo.name, 'tipo': achado['tipo'],
        'numeroLote': lote_.numero_lote if lote_ else achado['numeroLote'],
        'convenioId': c.id if c else None, 'convenioNome': achado['convenioNome'],
        'protocolo': achado['protocolo'], 'loteId': lote_.id if lote_ else None, 'valorProtocolo': achado.get('valor'),
        'extraidos': extraidos, 'loteNaoLancado': nao_lancado, 'podeLancar': request.user.faz_faturamento,
        'candidatos': [candidato_json(l, request.user) for l in candidatos[:10]], 'avisos': avisos,
    })


def filtro_envios(request):
    q, u = request.GET, request.user
    qs = EnvioXml.objects.select_related('convenio', 'responsavel', 'lote', 'lote__faturista')
    if not u.ve_todos:
        qs = qs.filter(responsavel=u)
    elif q.get('responsavel'):
        qs = qs.filter(responsavel_id=q['responsavel'])
    if q.get('convenio'):
        qs = qs.filter(convenio_id=q['convenio'])
    if q.get('situacao') == 'amarrado':
        qs = qs.filter(lote__isnull=False)
    elif q.get('situacao') == 'aguardando':
        qs = qs.filter(lote__isnull=True)
    if para_data(q.get('inicio')):
        qs = qs.filter(data_envio__gte=q['inicio'])
    if para_data(q.get('fim')):
        qs = qs.filter(data_envio__lte=q['fim'])
    if q.get('busca'):
        qs = qs.filter(Q(numero_lote__icontains=q['busca']) | Q(protocolo__icontains=q['busca']))
    return qs



def ler_valor(v):
    """'2.327,79' / '2327.79' / 2327.79 → Decimal; vazio → None."""
    if v in (None, ''):
        return None
    t = str(v).strip()
    if ',' in t:
        t = t.replace('.', '').replace(',', '.')
    try:
        return Decimal(t).quantize(Decimal('0.01'))
    except InvalidOperation:
        raise ValueError('Valor do protocolo inválido.')


@api(None, ('GET', 'POST'))
def envios_xml(request):
    if request.method == 'GET':
        return JsonResponse([envio_json(e, request.user) for e in filtro_envios(request)[:1000]], safe=False)
    d, u = request.dados, request.user
    data_envio = para_data(d.get('dataEnvio'))
    if not data_envio:
        return erro('Informe a data do envio.')
    if d.get('loteId'):
        lote_ = Lote.objects.filter(pk=d['loteId']).select_related('convenio').first()
        if not lote_:
            return erro('Lote não encontrado.', 404)
        numero, conv = lote_.numero_lote, lote_.convenio
    else:
        numero = str(d.get('numeroLote') or '').strip()
        conv = Convenio.objects.filter(pk=d.get('convenioId') or 0).first()
        if not numero or not conv:
            return erro('Informe o número do lote e o convênio.')
        lote_ = Lote.objects.filter(numero_lote=numero, convenio=conv).first()
    if not conv.tem_xml:
        return erro(f'{conv.nome} está marcado como convênio sem XML. Peça à coordenação para mudar.')
    try:
        valor_protocolo = ler_valor(d.get('valorProtocolo'))
    except ValueError as ex:
        return erro(str(ex))
    e = EnvioXml.objects.create(
        numero_lote=numero, convenio=conv, lote=lote_,
        responsavel_id=d.get('responsavelId') if u.ve_todos and d.get('responsavelId') else u.id,
        protocolo=str(d.get('protocolo') or '').strip(), data_envio=data_envio,
        observacao=d.get('observacao') or '', nome_arquivo=str(d.get('nomeArquivo') or '')[:200],
        valor_protocolo=valor_protocolo)
    if caminho := pegar_pendente(d.get('arquivoId')):
        anexar(e.arquivo, f'xml-{e.id}{caminho.suffix}', caminho)
    diverge = bool(lote_ and valor_protocolo is not None and abs(valor_protocolo - lote_.valor_total) >= Decimal('0.01'))
    return JsonResponse({'id': e.id, 'amarrado': bool(lote_), 'numeroLote': numero, 'divergente': diverge,
                         'faturista': lote_.faturista.nome if diverge else None})


def envio_do_usuario(request, pk):
    e = EnvioXml.objects.filter(pk=pk).first()
    if not e:
        return None, erro('Envio não encontrado.', 404)
    if not request.user.ve_todos and e.responsavel_id != request.user.id:
        return None, erro('Sem acesso.', 403)
    return e, None


@api(None, ('PUT', 'DELETE'))
def envio_xml(request, pk):
    e, resp = envio_do_usuario(request, pk)
    if resp:
        return resp
    if request.method == 'DELETE':
        if e.arquivo:
            e.arquivo.delete(save=False)
        e.delete()
        return JsonResponse({'ok': True})
    d = request.dados
    numero = str(d.get('numeroLote') or e.numero_lote).strip()
    conv = Convenio.objects.filter(pk=d.get('convenioId') or e.convenio_id).first()
    data_envio = para_data(d.get('dataEnvio'))
    if not numero or not conv or not data_envio:
        return erro('Preencha lote, convênio e data do envio.')
    e.numero_lote, e.convenio, e.data_envio = numero, conv, data_envio
    e.protocolo = str(d.get('protocolo') or '').strip()
    if 'valorProtocolo' in d:
        try:
            e.valor_protocolo = ler_valor(d.get('valorProtocolo'))
        except ValueError as ex:
            return erro(str(ex))
    e.observacao = d.get('observacao') or ''
    e.lote = Lote.objects.filter(numero_lote=numero, convenio=conv).first()  # reamarra se o lote mudou
    e.save()
    return JsonResponse({'ok': True, 'amarrado': bool(e.lote)})


@api()
def envio_arquivo(request, pk):
    e, resp = envio_do_usuario(request, pk)
    if resp:
        return resp
    if not e.arquivo:
        return erro('Envio sem arquivo.', 404)
    return FileResponse(e.arquivo.open('rb'), filename=e.nome_arquivo or Path(e.arquivo.name).name)


@api()
def xml_pendentes(request):
    qs = lotes_sem_xml(request).order_by('data_lancamento', 'id')
    feriados = feriados_do_mes()
    return JsonResponse([{**candidato_json(l, request.user), 'prazo_texto': l.convenio.prazo_texto,
                          'aberto_hoje': aberto_hoje(l.convenio, feriados),
                          'responsavel_xml': l.convenio.responsavel_xml.nome if l.convenio.responsavel_xml else None}
                         for l in qs[:500]], safe=False)


@api()
def xml_resumo(request):
    envios = filtro_envios(request)
    mes = hoje().replace(day=1)
    pend = lotes_sem_xml(request).aggregate(n=Count('id'), valor=Sum('valor_total'))
    return JsonResponse({
        'pendentes': pend['n'], 'pendentesValor': float(pend['valor'] or 0) if request.user.ve_todos else None,
        'enviadosMes': envios.filter(data_envio__gte=mes).count(),
        'aguardandoLote': envios.filter(lote__isnull=True).count(),
    })


# ---------- Relatórios ----------
def agrupador(chave):
    return {
        'dia': F('data_lancamento'), 'mes': TruncMonth('data_lancamento'), 'ano': TruncYear('data_lancamento'),
        'competencia': F('competencia'), 'convenio': F('convenio__nome'), 'faturista': F('faturista__first_name'),
    }.get(chave, TruncMonth('data_lancamento'))


def rotulo(chave, valor):
    if isinstance(valor, date):
        return valor.isoformat()[:7] if chave == 'mes' else valor.isoformat()[:4] if chave == 'ano' else valor.isoformat()
    return valor


def somas(qs):
    return qs.annotate(lotes=Count('id'), guias=Sum('qtd_guias'), valor=Sum('valor_total'))


def linha(chave, r):
    return {'grupo': rotulo(chave, r['grupo']), 'lotes': r['lotes'], 'guias': r['guias'] or 0, 'valor': round(float(r['valor'] or 0), 2)}


def totais(qs):
    t = qs.aggregate(lotes=Count('id'), guias=Sum('qtd_guias'), valor=Sum('valor_total'))
    return {'lotes': t['lotes'], 'guias': t['guias'] or 0, 'valor': round(float(t['valor'] or 0), 2)}


@api()
def relatorios(request):
    por = request.GET.get('por', 'mes')
    qs = filtro_lotes(request)
    linhas = [linha(por, r) for r in somas(qs.values(grupo=agrupador(por)).order_by()).order_by('grupo')]
    if por in ('convenio', 'faturista'):
        linhas.sort(key=lambda r: -r['valor'])
    return JsonResponse({'por': por, 'totais': totais(qs), 'linhas': linhas})


@api('gestao')
def producao(request):
    """Produção de cada faturista por dia, mês ou ano (uma linha por período e pessoa)."""
    por = request.GET.get('por', 'dia')
    qs = filtro_lotes(request).values(grupo=agrupador(por), faturista_nome=F('faturista__first_name'))
    dados = [{**linha(por, r), 'faturista': r['faturista_nome']} for r in somas(qs.order_by())]
    dados.sort(key=lambda r: -r['valor'])
    dados.sort(key=lambda r: r['grupo'], reverse=True)
    return JsonResponse(dados, safe=False)


@api()
def relatorio_csv(request):
    qs = filtro_lotes(request).annotate(tem_envio=com_envio()).order_by('data_lancamento', 'id')
    xml = {'na': 'sem XML', 'enviado': 'enviado', 'pendente': 'pendente'}
    cab = ['Lote', 'Convênio', 'Faturista', 'Competência', 'Data lançamento', 'Guias', 'Valor', 'Status', 'XML', 'Tipo']
    esc = lambda v: '"' + str(v if v is not None else '').replace('"', '""') + '"'
    linhas = [';'.join(map(esc, cab))]
    for l in qs:
        j = lote_json(l)
        linhas.append(';'.join(map(esc, [l.numero_lote, l.convenio.nome, l.faturista.nome, l.competencia,
                                         l.data_lancamento.strftime('%d/%m/%Y'), l.qtd_guias,
                                         f'{l.valor_total:.2f}'.replace('.', ','), l.get_status_display(),
                                         xml[j['xml']], l.tipo])))
    resp = HttpResponse('﻿' + '\r\n'.join(linhas), content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="faturale-relatorio.csv"'
    return resp


@api('diretoria')
def painel(request):
    agora = hoje()
    atual = agora.replace(day=1)
    anterior = date(atual.year - (atual.month == 1), (atual.month - 2) % 12 + 1, 1)

    def do_mes(inicio, ate_dia=31):
        qs = Lote.objects.filter(data_lancamento__year=inicio.year, data_lancamento__month=inicio.month,
                                 data_lancamento__day__lte=ate_dia)
        return totais(qs)

    base = Lote.objects.all()
    evolucao = [linha('mes', r) for r in somas(base.values(grupo=TruncMonth('data_lancamento')).order_by())
                .order_by('-grupo')[:12]][::-1]
    convenios_ano = sorted((linha('convenio', r) for r in somas(
        base.filter(data_lancamento__year=agora.year).values(grupo=agrupador('convenio')).order_by())), key=lambda r: -r['valor'])
    equipe = sorted((linha('faturista', r) for r in somas(
        base.filter(data_lancamento__gte=atual).values(grupo=agrupador('faturista')).order_by())), key=lambda r: -r['valor'])
    status = [{'grupo': r['status'], 'lotes': r['n']} for r in base.values('status').annotate(n=Count('id')).order_by('status')]
    pend = Lote.objects.filter(~com_envio(), convenio__tem_xml=True).aggregate(n=Count('id'), valor=Sum('valor_total'))
    return JsonResponse({
        'atual': atual.isoformat()[:7], 'anterior': anterior.isoformat()[:7], 'diaHoje': agora.day,
        'mesAtual': do_mes(atual), 'mesAnterior': do_mes(anterior), 'mesAnteriorAteHoje': do_mes(anterior, agora.day),
        'evolucao': evolucao, 'convenios': convenios_ano, 'equipe': equipe, 'status': status,
        'xmlPendentes': {'lotes': pend['n'], 'valor': float(pend['valor'] or 0)},
    })


# ---------- Calendário de entregas ----------
def entrega_json(e, u):
    c = e.convenio
    meu = u.id in (c.faturista_id, c.responsavel_xml_id)
    return {
        'id': e.id, 'data': iso(e.data), 'convenio_id': c.id, 'convenio': c.nome, 'observacao': e.observacao,
        'concluido': e.concluido, 'concluido_por': e.concluido_por.nome if e.concluido_por else None,
        'faturista_id': c.faturista_id, 'faturista': c.faturista.nome if c.faturista else None,
        'xml_id': c.responsavel_xml_id, 'responsavel_xml': c.responsavel_xml.nome if c.responsavel_xml else None,
        'tem_xml': c.tem_xml, 'meu': meu, 'pode_concluir': meu or u.ve_todos,
    }


def entregas_qs():
    return EntregaCalendario.objects.select_related('convenio', 'convenio__faturista', 'convenio__responsavel_xml', 'concluido_por')


@api(None, ('GET', 'POST'))
def calendario(request):
    u = request.user
    if request.method == 'GET':
        try:
            ano, mes = map(int, (request.GET.get('mes') or hoje().strftime('%Y-%m')).split('-'))
            inicio = date(ano, mes, 1)
        except ValueError:
            return erro('Mês inválido (use AAAA-MM).')
        fim = date(ano + mes // 12, mes % 12 + 1, 1)
        return JsonResponse({
            'mes': inicio.isoformat()[:7], 'hoje': iso(hoje()),
            'entregas': [entrega_json(e, u) for e in entregas_qs().filter(data__gte=inicio, data__lt=fim)],
            'feriados': [{'data': iso(f.data), 'descricao': f.descricao} for f in Feriado.objects.filter(data__gte=inicio, data__lt=fim)],
        })
    if not u.pode('gestao'):
        return erro('Só a supervisão e a coordenação mudam o calendário.', 403)
    d = request.dados
    dia = para_data(d.get('data'))
    c = resolver_convenio(d)
    if not dia or not c:
        return erro('Informe o dia e o convênio.')
    e, criado = EntregaCalendario.objects.get_or_create(data=dia, convenio=c, observacao=str(d.get('observacao') or '').strip()[:80])
    if not criado:
        return erro(f'{c.nome} já está nesse dia.', 409)
    return JsonResponse(entrega_json(entregas_qs().get(pk=e.pk), u))


@api(None, ('PATCH', 'DELETE'))
def entrega(request, pk):
    e = entregas_qs().filter(pk=pk).first()
    if not e:
        return erro('Entrega não encontrada.', 404)
    u = request.user
    if request.method == 'DELETE':
        if not u.pode('gestao'):
            return erro('Só a supervisão e a coordenação mudam o calendário.', 403)
        e.delete()
        return JsonResponse({'ok': True})
    if not entrega_json(e, u)['pode_concluir']:
        return erro('Só quem fatura ou passa o XML desse convênio (ou a gestão) marca como entregue.', 403)
    e.concluido = bool(request.dados.get('concluido'))
    e.concluido_por = u if e.concluido else None
    e.concluido_em = timezone.now() if e.concluido else None
    e.save()
    return JsonResponse(entrega_json(e, u))


@api(None, ('GET',))
def calendario_proximos(request):
    """Próximos 3 dias com entrega, a partir de hoje (regra: entregar ao setor 1 dia antes)."""
    dias = list(EntregaCalendario.objects.filter(data__gte=hoje()).values_list('data', flat=True).distinct().order_by('data')[:3])
    qs = entregas_qs().filter(data__in=dias)
    return JsonResponse({'hoje': iso(hoje()), 'entregas': [entrega_json(e, request.user) for e in qs]})


@api('gestao', ('POST',))
def feriado(request):
    d = request.dados
    dia = para_data(d.get('data'))
    if not dia:
        return erro('Data inválida.')
    if d.get('feriado'):
        Feriado.objects.update_or_create(data=dia, defaults={'descricao': str(d.get('descricao') or 'Feriado')[:80]})
    else:
        Feriado.objects.filter(data=dia).delete()
    return JsonResponse({'ok': True})


# ---------- Alertas (topo de todas as telas) ----------
def dias_abertos_no_mes(c, ano, mes, feriados):
    d = date(ano, mes, 1)
    while d.month == mes:
        if c.aberto_em(d, feriados):
            yield d
        d += timedelta(days=1)


def proximo_dia_util(d, feriados):
    d += timedelta(days=1)
    while d.weekday() >= 5 or d in feriados:
        d += timedelta(days=1)
    return d


DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']


@api()
def alertas(request):
    """Último dia do portal (hoje / próximo dia útil) e próximo envio do calendário.
    Faturista: só os convênios dela (fatura ou passa XML). Gestão e coordenação: todos."""
    u, agora = request.user, hoje()
    feriados = feriados_do_mes(agora) | feriados_do_mes(agora.replace(day=28) + timedelta(days=4))
    convs = Convenio.objects.filter(ativo=True).exclude(prazo_tipo='livre')
    if not u.ve_todos:
        convs = convs.filter(Q(faturista=u) | Q(responsavel_xml=u))
    util = proximo_dia_util(agora, feriados)
    hoje_ultimo, logo_ultimo = [], []
    for c in convs:
        abertos = list(dias_abertos_no_mes(c, agora.year, agora.month, feriados))
        if not abertos:
            continue
        ultimo = abertos[-1]
        if ultimo == agora:
            hoje_ultimo.append(c.nome)
        elif agora < ultimo <= util:
            logo_ultimo.append(c.nome)
    lista = []
    if hoje_ultimo:
        lista.append({'nivel': 'urgente', 'titulo': 'Último dia do portal hoje', 'itens': sorted(hoje_ultimo)})
    if logo_ultimo:
        quando = 'amanhã' if util == agora + timedelta(days=1) else f'{DIAS_SEMANA[util.weekday()]} {util:%d/%m}'
        lista.append({'nivel': 'atencao', 'titulo': f'Último dia do portal: {quando}', 'itens': sorted(logo_ultimo)})

    # Próximo envio do calendário ainda não entregue
    ents = EntregaCalendario.objects.select_related('convenio').filter(data__gte=agora, concluido=False)
    if not u.ve_todos:
        ents = ents.filter(Q(convenio__faturista=u) | Q(convenio__responsavel_xml=u))
    primeira = ents.order_by('data').first()
    if primeira:
        dia = primeira.data
        nomes = sorted({e.convenio.nome for e in ents.filter(data=dia)})
        if dia == agora:
            titulo, nivel = 'Envio de hoje (calendário)', 'urgente'
        elif dia == proximo_dia_util(agora, feriados):
            titulo, nivel = f'Próximo envio: {"amanhã" if dia == agora + timedelta(days=1) else f"{DIAS_SEMANA[dia.weekday()]} {dia:%d/%m}"} — entregue hoje ao setor', 'atencao'
        else:
            titulo, nivel = f'Próximo envio: {DIAS_SEMANA[dia.weekday()]} {dia:%d/%m}', 'info'
        lista.append({'nivel': nivel, 'titulo': titulo, 'itens': nomes, 'aba': 'calendario'})
    # Valor do lote diferente do protocolo do convênio: o faturista corrige
    lotes = Lote.objects.filter(envios_xml__valor_protocolo__isnull=False).distinct().select_related('convenio').prefetch_related('envios_xml')
    if not u.ve_todos:
        lotes = lotes.filter(faturista=u)
    itens = [f'lote {l.numero_lote} ({l.convenio.nome}): sistema {moeda_br(l.valor_total)} · convênio {moeda_br(v)}'
             for l in lotes if (v := divergencia(l)) is not None]
    if itens:
        lista.insert(0, {'nivel': 'urgente', 'aba': 'faturamento' if not u.ve_todos else 'gestao',
                         'titulo': 'Valor diferente do protocolo do convênio — corrija o lote' if not u.ve_todos
                         else 'Lotes com valor diferente do protocolo do convênio', 'itens': itens})
    return JsonResponse({'hoje': iso(agora), 'alertas': lista})


def moeda_br(v):
    return 'R$ ' + f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


# ---------- Tempo real ----------
@api()
def versao(request):
    """Muda sempre que alguém lança, altera, confere ou apaga lote, envia XML ou marca entrega.
    As telas perguntam isto a cada 10 s e se atualizam quando muda."""
    from django.db.models import Max
    l = Lote.objects.aggregate(n=Count('id'), m=Max('atualizado_em'))
    e = EnvioXml.objects.aggregate(n=Count('id'), m=Max('atualizado_em'))
    c = EntregaCalendario.objects.aggregate(n=Count('id'), m=Max('concluido_em'))
    marca = lambda d: f"{d['n']}-{d['m'].timestamp() if d['m'] else 0}"
    return JsonResponse({'versao': f'{marca(l)}|{marca(e)}|{marca(c)}'})


# ---------- Mensagens entre a equipe ----------
def mensagem_json(m, u):
    return {'id': m.id, 'autor': m.autor.nome, 'autor_id': m.autor_id, 'minha': m.autor_id == u.id,
            'texto': m.texto, 'criado_em': timezone.localtime(m.criado_em).isoformat(timespec='seconds')}


def conversa_qs(u, com):
    """'equipe' = conversa de todos; senão o id da outra pessoa."""
    if com == 'equipe':
        return Mensagem.objects.filter(destinatario__isnull=True)
    outro = int(com)
    return Mensagem.objects.filter(Q(autor=u, destinatario_id=outro) | Q(autor_id=outro, destinatario=u))


def nao_lidas(u):
    equipe = Mensagem.objects.filter(destinatario__isnull=True, id__gt=u.equipe_lida_ate).exclude(autor=u).count()
    por_pessoa = dict(Mensagem.objects.filter(destinatario=u, lida_em__isnull=True)
                      .values_list('autor_id').annotate(n=Count('id')))
    return equipe, por_pessoa


@api()
def mensagens_resumo(request):
    """Total de não lidas (para o número vermelho do botão)."""
    u = request.user
    equipe, por_pessoa = nao_lidas(u)
    # Última mensagem que a pessoa ainda não leu (para o aviso do Windows)
    ultima = (Mensagem.objects.select_related('autor')
              .filter(Q(destinatario=u, lida_em__isnull=True) | Q(destinatario__isnull=True, id__gt=u.equipe_lida_ate))
              .exclude(autor=u).order_by('-id').first())
    return JsonResponse({'naoLidas': equipe + sum(por_pessoa.values()),
                         'ultima': {**mensagem_json(ultima, u), 'conversa': 'equipe' if ultima.destinatario_id is None else str(ultima.autor_id),
                                    'equipe': ultima.destinatario_id is None} if ultima else None})


@api()
def mensagens_conversas(request):
    u = request.user
    equipe, por_pessoa = nao_lidas(u)
    ultima = lambda qs: (lambda m: mensagem_json(m, u) if m else None)(qs.select_related('autor').order_by('-id').first())
    lista = [{'chave': 'equipe', 'nome': 'Equipe toda', 'naoLidas': equipe, 'ultima': ultima(conversa_qs(u, 'equipe'))}]
    for p in Usuario.objects.filter(is_active=True).exclude(id=u.id).order_by('first_name'):
        lista.append({'chave': str(p.id), 'nome': p.nome, 'perfil': p.perfil, 'naoLidas': por_pessoa.get(p.id, 0),
                      'ultima': ultima(conversa_qs(u, str(p.id)))})
    # Equipe toda primeiro; depois quem tem mensagem mais recente
    lista[1:] = sorted(lista[1:], key=lambda c: (c['ultima'] or {}).get('id', 0), reverse=True)
    return JsonResponse(lista, safe=False)


@api(None, ('GET', 'POST'))
def mensagens(request):
    u, com = request.user, (request.GET.get('com') or request.dados.get('com') or 'equipe')
    if com != 'equipe' and not (str(com).isdigit() and Usuario.objects.filter(id=int(com), is_active=True).exclude(id=u.id).exists()):
        return erro('Conversa não encontrada.', 404)
    if request.method == 'POST':
        texto = str(request.dados.get('texto') or '').strip()
        if not texto:
            return erro('Escreva a mensagem.')
        m = Mensagem.objects.create(autor=u, destinatario=None if com == 'equipe' else Usuario.objects.get(id=int(com)), texto=texto[:2000])
        return JsonResponse(mensagem_json(m, u))
    qs = conversa_qs(u, com).select_related('autor')
    depois = request.GET.get('depois')
    lista = list(qs.filter(id__gt=int(depois)) if str(depois or '').isdigit() else qs.order_by('-id')[:100])
    lista.sort(key=lambda m: m.id)
    # Ao abrir a conversa, marca como lida
    if com == 'equipe':
        ultimo = qs.order_by('-id').values_list('id', flat=True).first() or 0
        if ultimo > u.equipe_lida_ate:
            Usuario.objects.filter(id=u.id).update(equipe_lida_ate=ultimo)
    else:
        Mensagem.objects.filter(autor_id=int(com), destinatario=u, lida_em__isnull=True).update(lida_em=timezone.now())
    return JsonResponse([mensagem_json(m, u) for m in lista], safe=False)
