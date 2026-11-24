"""Descarte de dados que passaram do prazo de guarda (LGPD: necessidade e eliminação ao fim do tratamento).

Os prazos NÃO têm valor padrão: precisam ser definidos com o jurídico/contabilidade e passados aqui.
Sem --executar, só mostra quantos itens seriam descartados (simulação). O registro (log) traz só contagens,
nunca nomes, textos ou conteúdo de arquivos.

Exemplos:
  python manage.py descartar_dados --mensagens-dias 365
  python manage.py descartar_dados --mensagens-dias 365 --arquivos-dias 1825 --executar
  python manage.py descartar_dados --contas-inativas-dias 180      (só lista; anonimizar é com o TI)
"""
import logging
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from faturamento.models import EnvioXml, Lote, Mensagem, Usuario

log = logging.getLogger('faturale.seguranca')


class Command(BaseCommand):
    help = 'Descarta dados com prazo de guarda vencido. Simulação por padrão; use --executar para valer.'

    def add_arguments(self, p):
        p.add_argument('--mensagens-dias', type=int, help='Apaga mensagens do chat (e anexos) mais antigas que N dias.')
        p.add_argument('--arquivos-dias', type=int,
                       help='Apaga os ARQUIVOS (PDF/XML) de lotes e envios mais antigos que N dias. Os totais lançados ficam.')
        p.add_argument('--contas-inativas-dias', type=int,
                       help='Só lista contas sem acesso há N dias (anonimizar é decisão do TI, pela tela de pedidos).')
        p.add_argument('--executar', action='store_true', help='Faz o descarte de verdade (sem isto, só simula).')

    def handle(self, *a, **o):
        valendo = o['executar']
        agora = timezone.now()
        resumo = {}
        if not any(o.get(k) for k in ('mensagens_dias', 'arquivos_dias', 'contas_inativas_dias')):
            self.stdout.write('Nenhum prazo informado. Os prazos de guarda ainda precisam ser definidos (veja a Política de Privacidade).')

        # Arquivos enviados e não confirmados (prazo fixo do sistema: 2 h)
        pasta = Path(settings.MEDIA_ROOT) / 'pendentes'
        velhos = [f for f in pasta.iterdir() if time.time() - f.stat().st_mtime > 7200] if pasta.exists() else []
        resumo['pendentes_2h'] = len(velhos)
        if valendo:
            for f in velhos:
                f.unlink(missing_ok=True)

        if o.get('mensagens_dias'):
            qs = Mensagem.objects.filter(criado_em__lt=agora - timedelta(days=o['mensagens_dias']))
            resumo['mensagens'] = qs.count()
            if valendo:
                for m in qs.exclude(arquivo=''):
                    m.arquivo.delete(save=False)
                qs.delete()

        if o.get('arquivos_dias'):
            limite = agora - timedelta(days=o['arquivos_dias'])
            for nome, modelo in (('arquivos_lotes', Lote), ('arquivos_xml', EnvioXml)):
                qs = modelo.objects.filter(criado_em__lt=limite).exclude(arquivo='')
                resumo[nome] = qs.count()
                if valendo:
                    for obj in qs:
                        obj.arquivo.delete(save=False)
                        obj.arquivo = ''
                        obj.save(update_fields=['arquivo'])

        if o.get('contas_inativas_dias'):
            limite = agora - timedelta(days=o['contas_inativas_dias'])
            inativas = Usuario.objects.filter(last_login__lt=limite).exclude(username__startswith='removido.')
            resumo['contas_inativas_para_avaliar'] = inativas.count()
            for u in inativas:
                self.stdout.write(f'  conta sem acesso desde {timezone.localtime(u.last_login):%d/%m/%Y}: id {u.id}')

        modo = 'DESCARTADO' if valendo else 'SIMULAÇÃO (nada apagado)'
        for k, n in resumo.items():
            self.stdout.write(f'{modo}: {k} = {n}')
        log.info('descarte de dados modo=%s %s', 'executar' if valendo else 'simulacao',
                 ' '.join(f'{k}={n}' for k, n in resumo.items()))
