"""python manage.py gerar_demo — monta a demonstração estática em docs/ para o GitHub Pages.

Copia as telas (mesmo app.js e styles.css do sistema), o servidor simulado (demo-api.js)
e exporta só os dados de demonstração para docs/dados.json. Nada de lote real vai junto.
"""
import json
import shutil
from datetime import date
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from faturamento.models import Convenio, EntregaCalendario, EnvioXml, Feriado, Lote, Usuario

APP = Path(__file__).resolve().parents[2]


def iso(d):
    return d.isoformat() if d else None


class Command(BaseCommand):
    help = 'Gera a demonstração estática (GitHub Pages) em docs/.'

    def handle(self, *args, **opts):
        destino = Path(settings.BASE_DIR) / 'docs'
        destino.mkdir(exist_ok=True)
        estaticos = APP / 'static' / 'faturamento'
        for nome in ('app.js', 'styles.css', 'logo-f.png'):
            shutil.copy2(estaticos / nome, destino / nome)
        shutil.copy2(APP / 'demo' / 'demo-api.js', destino / 'demo-api.js')

        html = (APP / 'templates' / 'faturamento' / 'index.html').read_text(encoding='utf-8')
        html = html.replace("{% load static %}", '')
        for nome in ('app.js', 'styles.css', 'logo-f.png'):
            html = html.replace(f"{{% static 'faturamento/{nome}' %}}", nome)
        html = html.replace(
            '<script type="module" src="app.js"></script>',
            '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>\n'
            '  <script src="demo-api.js"></script>\n'
            '  <script type="module" src="app.js"></script>')
        html = html.replace('<title>Faturale</title>', '<title>Faturale · demonstração</title>')
        (destino / 'index.html').write_text(html, encoding='utf-8')
        (destino / '.nojekyll').write_text('', encoding='utf-8')

        lotes = Lote.objects.filter(demo=True)
        dados = {
            'exportadoEm': date.today().isoformat(),
            'usuarios': [{'id': u.id, 'nome': u.nome, 'login': u.username, 'perfil': u.perfil, 'ativo': u.is_active, 'funcao': u.funcao,
                          'criado_em': u.date_joined.date().isoformat()} for u in Usuario.objects.order_by('id')],
            'convenios': [{'id': c.id, 'nome': c.nome, 'codigo': c.codigo, 'ativo': c.ativo, 'tem_xml': c.tem_xml,
                           'faturista_id': c.faturista_id, 'xml_id': c.responsavel_xml_id, 'prazo_texto': c.prazo_texto,
                           'prazo_inicio': c.prazo_inicio, 'prazo_fim': c.prazo_fim, 'prazo_tipo': c.prazo_tipo,
                           'prazo_dias': c.dias_lista, 'prazo_dia_util': c.prazo_dia_util, 'prazo_hora': c.prazo_hora} for c in Convenio.objects.all()],
            'lotes': [{'id': l.id, 'numero_lote': l.numero_lote, 'convenio_id': l.convenio_id, 'faturista_id': l.faturista_id,
                       'lancado_por_id': l.lancado_por_id, 'gerado_por': l.gerado_por, 'qtd_guias': l.qtd_guias,
                       'guias_texto': l.guias_texto, 'valor_total': float(l.valor_total), 'competencia': l.competencia,
                       'periodo_inicio': iso(l.periodo_inicio), 'periodo_fim': iso(l.periodo_fim), 'tipo': l.tipo,
                       'prestador': l.prestador, 'status': l.status, 'observacao': l.observacao,
                       'data_lancamento': iso(l.data_lancamento), 'demo': True} for l in lotes],
            'envios': [{'id': e.id, 'numero_lote': e.numero_lote, 'convenio_id': e.convenio_id, 'lote_id': e.lote_id,
                        'responsavel_id': e.responsavel_id, 'protocolo': e.protocolo, 'data_envio': iso(e.data_envio),
                        'nome_arquivo': e.nome_arquivo, 'observacao': e.observacao, 'demo': True,
                        'valor_protocolo': float(e.valor_protocolo) if e.valor_protocolo is not None else None}
                       for e in EnvioXml.objects.filter(demo=True, lote__demo=True)],
            'entregas': [{'id': e.id, 'data': iso(e.data), 'convenio_id': e.convenio_id, 'observacao': e.observacao,
                          'concluido': False, 'concluido_por_id': None} for e in EntregaCalendario.objects.all()],
            'feriados': [{'data': iso(f.data), 'descricao': f.descricao} for f in Feriado.objects.all()],
        }
        if not dados['lotes'] and (destino / 'dados.json').exists():
            # Banco de verdade sem dados fictícios: atualiza só as telas e mantém os dados da demonstração
            self.stdout.write(self.style.WARNING('Sem lotes de demonstração no banco: mantive o docs/dados.json atual.'))
            return
        (destino / 'dados.json').write_text(json.dumps(dados, ensure_ascii=False), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(
            f"Demonstração gerada em docs/: {len(dados['lotes'])} lotes, {len(dados['envios'])} envios, "
            f"{len(dados['entregas'])} entregas no calendário."))
