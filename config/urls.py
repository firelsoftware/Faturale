from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'Faturale · administração'
admin.site.site_title = 'Faturale'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('faturamento.urls')),
]
