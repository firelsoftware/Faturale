"""Quem entra por um endereço "de fora" (ex.: firelsoft.com.br sem o "faturale.") vai para o endereço do sistema."""
from django.conf import settings
from django.http import HttpResponsePermanentRedirect


class RedirecionarDominio:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host = request.get_host().split(':')[0].lower()
        destino = settings.FATURALE_ENDERECO
        if destino and host in settings.FATURALE_REDIRECIONAR:
            return HttpResponsePermanentRedirect(f'https://{destino}{request.get_full_path()}')
        return self.get_response(request)
