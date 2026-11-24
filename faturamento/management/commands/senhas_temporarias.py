"""python manage.py senhas_temporarias — troca senhas por senhas temporárias aleatórias.

Por padrão, só as contas que ainda estão com a antiga senha padrão (FATURALE_SENHA_INICIAL).
--login pessoa   : só essa pessoa (qualquer senha atual)
As senhas aparecem só na tela de quem rodou o comando, para repassar a cada pessoa.
No primeiro acesso, cada uma é obrigada a criar a própria senha."""
from django.conf import settings
from django.core.management.base import BaseCommand

from faturamento.models import Usuario
from faturamento.seguranca import senha_temporaria


class Command(BaseCommand):
    help = 'Gera senhas temporárias aleatórias (padrão: só quem ainda está com a antiga senha padrão).'

    def add_arguments(self, parser):
        parser.add_argument('--login', help='só esta pessoa')

    def handle(self, *args, **opts):
        if opts.get('login'):
            alvo = list(Usuario.objects.filter(username=opts['login']))
        else:
            alvo = [u for u in Usuario.objects.filter(is_active=True).order_by('first_name')
                    if u.check_password(settings.FATURALE_SENHA_INICIAL)]
        if not alvo:
            self.stdout.write('Nenhuma conta para trocar.')
            return
        self.stdout.write('Repasse cada senha só para a própria pessoa. Ela cria a dela no primeiro acesso.\n')
        self.stdout.write(f'{"NOME":32} {"USUÁRIO":22} SENHA TEMPORÁRIA')
        for u in alvo:
            senha = senha_temporaria()
            u.set_password(senha)
            u.trocar_senha = True
            u.save(update_fields=['password', 'trocar_senha'])
            self.stdout.write(f'{u.nome[:32]:32} {u.username:22} {senha}')
        self.stdout.write(self.style.SUCCESS(f'\n{len(alvo)} conta(s) com senha temporária nova.'))
