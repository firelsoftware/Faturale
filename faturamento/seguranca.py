"""Proteções do Faturale: limite de tentativas, senhas temporárias, registro de eventos e cabeçalhos.

- Limite de tentativas: guarda contadores no cache do Django (um processo do gunicorn com várias threads,
  então o contador é o mesmo para todas as requisições). Reiniciar o servidor zera os contadores.
- Senha temporária: aleatória, de uso único; a pessoa é obrigada a criar a dela no primeiro acesso.
- Registro: entradas, falhas e bloqueios vão para o log do servidor (sem senha nenhuma).
"""
import logging
import secrets

from django.core.cache import cache

log = logging.getLogger('faturale.seguranca')

# Sem letras/números que se confundem (l, 1, o, 0, i)
_ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'


def senha_temporaria():
    """Ex.: 'k7mq2-x9tpd' (10 caracteres aleatórios, ~49 bits)."""
    s = ''.join(secrets.choice(_ALFABETO) for _ in range(10))
    return f'{s[:5]}-{s[5:]}'


def ip_do_cliente(request):
    # Atrás do Fly.io o IP real vem no cabeçalho que o próprio proxy do Fly escreve
    return request.META.get('HTTP_FLY_CLIENT_IP') or request.META.get('REMOTE_ADDR', '') or '?'


def excedeu(chave, limite):
    return (cache.get(chave) or 0) >= limite


def contar(chave, janela):
    if cache.add(chave, 1, janela):
        return 1
    try:
        return cache.incr(chave)
    except ValueError:  # expirou entre o add e o incr
        cache.set(chave, 1, janela)
        return 1


def zerar(chave):
    cache.delete(chave)


class CabecalhosDeSeguranca:
    """Cabeçalhos que o Django não põe sozinho."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resposta = self.get_response(request)
        resposta.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
        resposta.headers.setdefault('Cross-Origin-Resource-Policy', 'same-origin')
        if request.path.startswith('/api/'):
            resposta.headers.setdefault('Cache-Control', 'no-store')  # dados da equipe não ficam em cache do navegador
        return resposta
