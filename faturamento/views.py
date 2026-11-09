"""API em JSON que as telas (static/faturamento/app.js) usam."""
import json
import re
import secrets
import time
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.files import File
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Q, Sum
from django.db.models.deletion import ProtectedError
from django.db.models.functions import TruncMonth, TruncYear
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from .extrator import extrair_lote, ler_protocolo_xml
from .management.commands.semear import normalizar
from .models import Convenio, EnvioXml, Lote, Usuario


# ---------- Utilidades ----------
def erro(msg, status=400):
    return JsonResponse({'erro': msg}, status=status)


def api(aba=None, metodos=('GET',)):
    """Exige login (e a aba, se houver), confere o método e lê o corpo JSON em request.dados."""
    def deco(fn):
        @wraps(fn)
        def inner(request, *a, **kw):
            if request.method not in metodos:
                return erro('Método não permitido.', 405)
            if not request.user.is_authenticated or not request.user.is_active:
                return erro('Faça login.', 401)
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
            'modoDemo': settings.FATURALE_MODO_DEMO, 'regraGuias': settings.FATURALE_REGRA_GUIAS}


# ---------- Entrar / sair ----------
def entrar_pessoas(request):
    """Lista quem pode entrar sem senha (só no modo demonstração)."""
    if not settings.FATURALE_MODO_DEMO:
        return JsonResponse([], safe=False)
    pessoas = Usuario.objects.filter(is_active=True).order_by('id')
    return JsonResponse([{'nome': u.nome, 'login': u.username, 'perfil': u.perfil} for u in pessoas], safe=False)


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


@api()
def eu(request):
    return JsonResponse(perfil_json(request.user))


# ---------- Pessoas ----------
@api()
def pessoas(request):
    qs = Usuario.objects.filter(is_active=True).order_by('first_name')
    return JsonResponse([{'id': u.id, 'nome': u.nome, 'perfil': u.perfil} for u in qs], safe=False)


def usuario_json(u):
    return {'id': u.id, 'nome': u.nome, 'login': u.username, 'perfil': u.perfil, 'ativo': u.is_active,
            'criado_em': u.date_joined.date().isoformat()}


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
    u = Usuario(username=login_, first_name=nome, perfil=d['perfil'])
    u.set_password(d['senha']) if d.get('senha') else u.set_unusable_password()
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
    alvo.is_active = bool(d.get('ativo'))
    if d.get('senha'):
        alvo.set_password(d['senha'])
    alvo.save()
    return JsonResponse({'ok': True})


# ---------- Convênios ----------
def aberto_hoje(c):
    return bool(c.prazo_inicio and c.prazo_fim and c.prazo_inicio <= hoje().day <= c.prazo_fim)


def convenio_json(c):
    return {
        'id': c.id, 'nome': c.nome, 'codigo': c.codigo, 'ativo': c.ativo, 'tem_xml': c.tem_xml,
        'faturista_id': c.faturista_id, 'faturista': c.faturista.nome if c.faturista else None,
        'xml_id': c.responsavel_xml_id, 'responsavel_xml': c.responsavel_xml.nome if c.responsavel_xml else None,
        'prazo_texto': c.prazo_texto, 'prazo_inicio': c.prazo_inicio, 'prazo_fim': c.prazo_fim, 'aberto_hoje': aberto_hoje(c),
    }


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
    if 'prazo_texto' in d:
        c.prazo_texto = str(d['prazo_texto'] or '').strip()
    for campo in ('prazo_inicio', 'prazo_fim'):
        if campo in d:
            v = d[campo]
            if v in (None, ''):
                setattr(c, campo, None)
            elif str(v).isdigit() and 1 <= int(v) <= 31:
                setattr(c, campo, int(v))
            else:
                raise ValueError('Dia do prazo deve ser de 1 a 31.')


@api(None, ('GET', 'POST'))
def convenios(request):
    if request.method == 'GET':
        qs = sorted(Convenio.objects.select_related('faturista', 'responsavel_xml'), key=lambda c: normalizar(c.nome))
        return JsonResponse([convenio_json(c) for c in qs], safe=False)
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


@api('coordenacao', ('PUT', 'DELETE'))
def convenio(request, pk):
    c = Convenio.objects.filter(pk=pk).first()
    if not c:
        return erro('Não encontrado.', 404)
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
        qs = qs.filter(Q(faturista=u) | Q(lancado_por=u)) if q.get('meus') else qs.filter(faturista=u)
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
        qs = filtro_lotes(request).annotate(tem_envio=com_envio()).order_by('-data_lancamento', '-id')[:1000]
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
    if not request.user.ve_todos and request.user.id not in (l.faturista_id, l.lancado_por_id):
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
def envio_json(e):
    return {
        'id': e.id, 'numero_lote': e.numero_lote, 'convenio_id': e.convenio_id, 'convenio': e.convenio.nome,
        'lote_id': e.lote_id, 'lote_guias': e.lote.qtd_guias if e.lote else None,
        'lote_valor': float(e.lote.valor_total) if e.lote else None,
        'faturista': e.lote.faturista.nome if e.lote else None,
        'responsavel_id': e.responsavel_id, 'responsavel': e.responsavel.nome, 'protocolo': e.protocolo,
        'data_envio': iso(e.data_envio), 'arquivo': bool(e.arquivo), 'nome_arquivo': e.nome_arquivo,
        'observacao': e.observacao, 'demo': e.demo,
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


def candidato_json(l):
    return {'id': l.id, 'numero_lote': l.numero_lote, 'convenio_id': l.convenio_id, 'convenio': l.convenio.nome,
            'faturista': l.faturista.nome, 'qtd_guias': l.qtd_guias, 'valor_total': float(l.valor_total),
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
    candidatos = []
    if achado['numeroLote']:
        qs = base.filter(numero_lote=achado['numeroLote'])
        candidatos = list(qs.filter(convenio=c) if c and qs.filter(convenio=c).exists() else qs)
    if not candidatos and achado['numeros']:
        # Procura no texto algum número de lote que ainda espera XML
        candidatos = list(lotes_sem_xml(request).filter(numero_lote__in=achado['numeros'][:500])[:10])
    lote_ = candidatos[0] if len(candidatos) == 1 else None
    if lote_:
        c = lote_.convenio
        ja = EnvioXml.objects.filter(lote=lote_).select_related('responsavel').first()
        if ja:
            avisos.append(f'Este lote já tem XML registrado em {ja.data_envio:%d/%m/%Y} por {ja.responsavel.nome}. '
                          'Salvar registra mais um envio.')
    elif achado['numeroLote'] and not candidatos:
        avisos.append('Lote ainda não lançado pelo faturamento. O protocolo fica aguardando e se amarra '
                      'sozinho quando o lote for lançado.')
    elif not candidatos:
        avisos.append('Não achei o número do lote no arquivo. Escolha o lote na lista ou digite o número.')
    return JsonResponse({
        'arquivoId': token, 'nomeArquivo': arquivo.name, 'tipo': achado['tipo'],
        'numeroLote': lote_.numero_lote if lote_ else achado['numeroLote'],
        'convenioId': c.id if c else None, 'convenioNome': achado['convenioNome'],
        'protocolo': achado['protocolo'], 'loteId': lote_.id if lote_ else None,
        'candidatos': [candidato_json(l) for l in candidatos[:10]], 'avisos': avisos,
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


@api(None, ('GET', 'POST'))
def envios_xml(request):
    if request.method == 'GET':
        return JsonResponse([envio_json(e) for e in filtro_envios(request)[:1000]], safe=False)
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
    e = EnvioXml.objects.create(
        numero_lote=numero, convenio=conv, lote=lote_,
        responsavel_id=d.get('responsavelId') if u.ve_todos and d.get('responsavelId') else u.id,
        protocolo=str(d.get('protocolo') or '').strip(), data_envio=data_envio,
        observacao=d.get('observacao') or '', nome_arquivo=str(d.get('nomeArquivo') or '')[:200])
    if caminho := pegar_pendente(d.get('arquivoId')):
        anexar(e.arquivo, f'xml-{e.id}{caminho.suffix}', caminho)
    return JsonResponse({'id': e.id, 'amarrado': bool(lote_), 'numeroLote': numero})


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
    return JsonResponse([{**candidato_json(l), 'prazo_texto': l.convenio.prazo_texto,
                          'aberto_hoje': aberto_hoje(l.convenio),
                          'responsavel_xml': l.convenio.responsavel_xml.nome if l.convenio.responsavel_xml else None}
                         for l in qs[:500]], safe=False)


@api()
def xml_resumo(request):
    envios = filtro_envios(request)
    mes = hoje().replace(day=1)
    pend = lotes_sem_xml(request).aggregate(n=Count('id'), valor=Sum('valor_total'))
    return JsonResponse({
        'pendentes': pend['n'], 'pendentesValor': float(pend['valor'] or 0),
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


@api('coordenacao')
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
