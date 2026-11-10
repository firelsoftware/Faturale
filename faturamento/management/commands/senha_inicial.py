"""python manage.py senha_inicial — põe a senha inicial (FATURALE_SENHA_INICIAL) em todo mundo
e obriga cada pessoa a trocar no primeiro acesso. Use --login para uma pessoa só."""
from django.conf import settings
from django.core.management.base import BaseCommand

from faturamento.models import Usuario


class Command(BaseCommand):
    help = 'Põe a senha inicial em todos (ou em --login) e obriga a trocar no primeiro acesso.'

    def add_arguments(self, parser):
        parser.add_argument('--login', help='só esta pessoa')

    def handle(self, *args, **opts):
        qs = Usuario.objects.all()
        if opts.get('login'):
            qs = qs.filter(username=opts['login'])
        for u in qs:
            u.set_password(settings.FATURALE_SENHA_INICIAL)
            u.trocar_senha = True
            u.save()
        self.stdout.write(self.style.SUCCESS(f'Senha inicial definida para {qs.count()} pessoa(s). Cada uma troca no primeiro acesso.'))
