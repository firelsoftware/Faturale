"""python manage.py semear — cria a equipe, os convênios e os dados de demonstração.

Pode rodar quantas vezes quiser: só cria o que ainda não existe e nunca
desfaz o que a coordenação já mudou pela tela.
"""
import random
import unicodedata
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from faturamento.models import Convenio, EnvioXml, Lote, Usuario

EQUIPE = [
    # nome, login, perfil
    ('Leandro', 'leandro', 'diretor'),
    ('Thalita', 'thalita', 'coordenadora'),
    ('Larissa', 'larissa', 'supervisora'),
    ('Fabricio', 'fabricio', 'faturista'),
    ('Mister', 'mister', 'faturista'),  # "Misterlândia" na planilha de XML
    ('Stephanie', 'stephanie', 'faturista'),
    ('Emmily', 'emmily', 'faturista'),
    ('Marlene', 'marlene', 'faturista'),
    ('Marcos', 'marcos', 'faturista'),
]

# Planilha "Envio de XML - Divisão de Convênios".
# Clinbrás, Fusex e Nova Saúde aparecem em duas colunas: ficam com a primeira.
DIVISAO_XML = {
    'mister': ['Bradesco Saúde', 'STJ', 'TJDFT', 'Assefaz', 'Caixa', 'SulAmérica', 'Clinbrás', 'HFA', 'Plenum'],
    'stephanie': ['Amil', 'Unity', 'Notredame', 'Câmara', 'Bombeiro', 'Anchieta', 'Conab', 'Grupo Santa', 'Polícia Federal', 'Nova Saúde'],
    'emmily': ['Porto Seguro', 'PM', 'Medservice', 'Gravia', 'Affego', 'Benecap', 'Força Policial', 'Life', 'Prevent Senior', 'Unafisco'],
    'fabricio': ['Cassi', 'GEAP', 'Serpro', 'Clinbrás', 'Benefis', 'Capsesp', 'Fusex', 'Naval', 'S1 Saúde', 'TRE'],
    'marlene': ['Postal Saúde', 'CNU', 'Unimed Seguros', 'Casembrapa', 'Fascal', 'Casec', 'Gama', 'Luminar', 'Salutá', 'STF'],
    'marcos': ['Inas', 'Fusex', 'Bacen', 'AMHP', 'BRB', 'ASPDF', 'E-vida', 'Nova Saúde', 'Omint', 'Select'],
}

# "Portais fixos" do calendário: texto, dia em que abre, dia em que fecha
PORTAIS = {
    'Affego': ('1 à 7', 1, 7), 'Amil': ('até as 17h (dias úteis)', None, None), 'Anchieta': ('1 à 7', 1, 7),
    'ASPDF': ('até o 5º dia útil', None, None), 'Assefaz': ('1 à 10', 1, 10), 'Benecap': ('1 à 7', 1, 7),
    'Benefis': ('1 e 2', 1, 2), 'Bradesco Saúde': ('9 a 27', 9, 27), 'BRB': ('3 e 4', 3, 4), 'Capsesp': ('1 à 5', 1, 5),
    'Casec': ('1 e 2', 1, 2), 'Casembrapa': ('1 e 2', 1, 2), 'Cassi': ('1 à 20', 1, 20), 'Clinbrás': ('1 à 10', 1, 10),
    'Conab': ('1 à 8', 1, 8), 'E-vida': ('1 à 5', 1, 5), 'Fascal': ('1 à 10', 1, 10), 'Força Policial': ('1 à 15', 1, 15),
    'Fusex': ('diário até as 17h', None, None), 'Gama': ('1 à 6', 1, 6), 'GEAP': ('1 à 10', 1, 10),
    'Gravia': ('primeiros 7 dias úteis', None, None), 'Grupo Santa': ('1 à 7', 1, 7), 'HFA': ('1 à 7', 1, 7),
    'Life': ('1 à 10', 1, 10), 'Luminar': ('1 à 7', 1, 7), 'Naval': ('1 à 10', 1, 10), 'Nova Saúde': ('1 à 3', 1, 3),
    'Omint': ('1 à 7', 1, 7), 'Plenum': ('1 à 5 úteis, até as 17h', None, None), 'Polícia Federal': ('1 à 3', 1, 3),
    'Porto Seguro': ('1 à 15', 1, 15), 'Postal Saúde': ('1 à 5', 1, 5), 'Prevent Senior': ('1 à 7', 1, 7),
    'S1 Saúde': ('3 e 4', 3, 4), 'Salutá': ('1 à 7', 1, 7), 'Select': ('1 à 7 e 10 e 11', 1, 7), 'Serpro': ('1 à 15', 1, 15),
    'STF': ('1 à 21', 1, 21), 'SulAmérica': ('10 e 11', 10, 11), 'TRE': ('Isob 1 à 5 · HOB 17 à 20', 1, 5),
    'Unafisco': ('1 à 7', 1, 7), 'Unimed Seguros': ('1 à 21', 1, 21), 'Unity': ('1 à 5', 1, 5),
}

CODIGOS = {'Bradesco Saúde': '635902'}

# Quem fatura (exemplo para a demonstração; a coordenação muda pela tela)
FATURAMENTO = {
    'fabricio': ['Bradesco Saúde', 'Cassi', 'GEAP', 'Amil', 'SulAmérica'],
    'mister': ['Unimed', 'Caixa', 'STJ', 'TJDFT', 'Assefaz', 'Porto Seguro'],
}


def normalizar(s):
    s = unicodedata.normalize('NFD', s or '')
    return ''.join(c for c in s.lower() if c.isalnum())


class Command(BaseCommand):
    help = 'Cria a equipe, os convênios e os dados de demonstração (só o que faltar).'

    @transaction.atomic
    def handle(self, *args, **opts):
        pessoas = {}
        for nome, login, perfil in EQUIPE:
            u, criado = Usuario.objects.get_or_create(username=login, defaults={'first_name': nome, 'perfil': perfil})
            if criado:
                u.set_unusable_password()  # demonstração: entra sem senha
                u.is_staff = u.is_superuser = perfil == 'diretor'  # Leandro abre o /admin
                u.save()
            pessoas[login] = u

        convenios = {normalizar(c.nome): c for c in Convenio.objects.all()}

        def convenio(nome):
            c = convenios.get(normalizar(nome))
            if not c:
                c = Convenio.objects.create(nome=nome, codigo=CODIGOS.get(nome))
                convenios[normalizar(nome)] = c
            return c

        primeira_vez = not Convenio.objects.exists()
        if primeira_vez:
            for login, nomes in DIVISAO_XML.items():
                for nome in nomes:
                    c = convenio(nome)
                    if not c.responsavel_xml_id:
                        c.responsavel_xml = pessoas[login]
                        c.save()
            # Unimed não está na planilha de XML: exemplo de convênio sem XML
            convenio('Unimed').tem_xml = False
            convenios[normalizar('Unimed')].save()
            for login, nomes in FATURAMENTO.items():
                for nome in nomes:
                    c = convenio(nome)
                    c.faturista = pessoas[login]
                    c.save()
            for nome, (texto, ini, fim) in PORTAIS.items():
                c = convenio(nome)
                c.prazo_texto, c.prazo_inicio, c.prazo_fim = texto, ini, fim
                c.save()
            self.semear_demonstracao(pessoas, convenios)

        self.stdout.write(self.style.SUCCESS(
            f'{Usuario.objects.count()} pessoas · {Convenio.objects.count()} convênios · '
            f'{Lote.objects.count()} lotes · {EnvioXml.objects.count()} envios de XML'))

    def semear_demonstracao(self, pessoas, convenios):
        """Lotes fictícios dos últimos 5 meses, marcados como demonstração."""
        rnd = random.Random(7)
        faturistas = [pessoas['fabricio'], pessoas['mister']]
        do_demo = [convenios[normalizar(n)] for n in
                   ['Bradesco Saúde', 'Amil', 'SulAmérica', 'Unimed', 'Cassi', 'GEAP', 'Caixa', 'Porto Seguro']]
        hoje = date.today()
        numero = 300000
        for d in range(150, 0, -1):
            dia = hoje - timedelta(days=d)
            if dia.weekday() >= 5:
                continue
            for _ in range(rnd.randint(1, 3)):
                c = rnd.choice(do_demo)
                guias = rnd.randint(3, 42)
                prox = date(dia.year + dia.month // 12, dia.month % 12 + 1, 1)
                lote = Lote.objects.create(
                    numero_lote=str(numero), convenio=c, faturista=c.faturista or rnd.choice(faturistas),
                    qtd_guias=guias, guias_texto=f'{guias}/{guias}',
                    valor_total=Decimal(guias * rnd.uniform(150, 400)).quantize(Decimal('0.01')),
                    competencia=prox.strftime('%Y-%m'), periodo_inicio=dia, periodo_fim=dia,
                    tipo='Exames' if rnd.random() < 0.6 else 'Consultas',
                    status='conferido' if d > 20 else 'lancado', data_lancamento=dia, demo=True)
                numero += 1
                # Lotes com mais de 10 dias já têm o XML enviado, para a fila não começar lotada
                if c.tem_xml and c.responsavel_xml and d > 10:
                    EnvioXml.objects.create(
                        numero_lote=lote.numero_lote, convenio=c, lote=lote, responsavel=c.responsavel_xml,
                        protocolo=f'XML{rnd.randint(100000, 999999)}', data_envio=dia + timedelta(days=2), demo=True)
