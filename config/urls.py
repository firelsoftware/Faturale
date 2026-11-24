from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'Faturale · administração'
admin.site.site_title = 'Faturale'

urlpatterns = [path('', include('faturamento.urls'))]
# Painel de administração do Django: fechado em produção; abre só com FATURALE_ADMIN=1
if settings.FATURALE_ADMIN:
    urlpatterns.insert(0, path('admin/', admin.site.urls))
