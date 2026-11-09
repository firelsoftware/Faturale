from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Convenio, EnvioXml, Lote, Usuario


@admin.register(Usuario)
class UsuarioAdmin(UserAdmin):
    list_display = ['username', 'first_name', 'perfil', 'is_active']
    list_filter = ['perfil', 'is_active']
    fieldsets = UserAdmin.fieldsets + (('Faturale', {'fields': ['perfil']}),)


@admin.register(Convenio)
class ConvenioAdmin(admin.ModelAdmin):
    list_display = ['nome', 'codigo', 'tem_xml', 'faturista', 'responsavel_xml', 'prazo_texto', 'ativo']
    list_filter = ['tem_xml', 'ativo', 'faturista', 'responsavel_xml']
    list_editable = ['tem_xml', 'faturista', 'responsavel_xml']
    search_fields = ['nome', 'codigo']


@admin.register(Lote)
class LoteAdmin(admin.ModelAdmin):
    list_display = ['numero_lote', 'convenio', 'faturista', 'competencia', 'data_lancamento', 'qtd_guias', 'valor_total', 'status']
    list_filter = ['status', 'convenio', 'faturista', 'competencia', 'demo']
    search_fields = ['numero_lote']
    date_hierarchy = 'data_lancamento'


@admin.register(EnvioXml)
class EnvioXmlAdmin(admin.ModelAdmin):
    list_display = ['numero_lote', 'convenio', 'responsavel', 'data_envio', 'lote', 'protocolo']
    list_filter = ['responsavel', 'convenio', 'demo']
    search_fields = ['numero_lote', 'protocolo']
