from django.contrib.auth.models import AbstractUser
from django.db import models


class Usuario(AbstractUser):
    class Perfil(models.TextChoices):
        FATURISTA = 'faturista', 'Faturista / XML'
        SUPERVISORA = 'supervisora', 'Supervisora'
        COORDENADORA = 'coordenadora', 'Coordenadora'
        DIRETOR = 'diretor', 'Diretor'

    perfil = models.CharField(max_length=20, choices=Perfil.choices, default=Perfil.FATURISTA)

    # Abas que cada perfil enxerga. A diretoria vê tudo.
    ABAS = {
        'faturista': ['faturamento', 'xml'],
        'supervisora': ['faturamento', 'xml', 'gestao'],
        'coordenadora': ['faturamento', 'xml', 'gestao', 'coordenacao'],
        'diretor': ['faturamento', 'xml', 'gestao', 'coordenacao', 'diretoria'],
    }

    @property
    def nome(self):
        return self.first_name or self.username

    @property
    def abas(self):
        return self.ABAS.get(self.perfil, [])

    def pode(self, aba):
        return aba in self.abas

    @property
    def ve_todos(self):
        """Faturista vê só o que é dela; os outros perfis veem a equipe."""
        return self.perfil != self.Perfil.FATURISTA

    def __str__(self):
        return self.nome


class Convenio(models.Model):
    nome = models.CharField(max_length=120)
    codigo = models.CharField('código', max_length=30, unique=True, null=True, blank=True)
    ativo = models.BooleanField(default=True)
    tem_xml = models.BooleanField('tem XML', default=True)
    faturista = models.ForeignKey(Usuario, models.SET_NULL, null=True, blank=True, related_name='convenios_faturamento',
                                  verbose_name='quem fatura')
    responsavel_xml = models.ForeignKey(Usuario, models.SET_NULL, null=True, blank=True, related_name='convenios_xml',
                                        verbose_name='quem passa o XML')
    # Portal do convênio, como está no calendário: "1 à 7", "até o 5º dia útil"…
    prazo_texto = models.CharField('prazo do portal', max_length=80, blank=True)
    prazo_inicio = models.PositiveSmallIntegerField('abre no dia', null=True, blank=True)
    prazo_fim = models.PositiveSmallIntegerField('fecha no dia', null=True, blank=True)

    class Meta:
        ordering = ['nome']
        verbose_name = 'convênio'

    def __str__(self):
        return self.nome


class Lote(models.Model):
    class Status(models.TextChoices):
        LANCADO = 'lancado', 'Lançado'
        CONFERIDO = 'conferido', 'Conferido'
        DEVOLVIDO = 'devolvido', 'Devolvido'

    numero_lote = models.CharField('nº do lote', max_length=40)
    convenio = models.ForeignKey(Convenio, models.PROTECT, related_name='lotes')
    # A produção conta para quem gerou o protocolo no sistema do hospital (lido do PDF);
    # lancado_por é quem subiu o arquivo no Faturale.
    faturista = models.ForeignKey(Usuario, models.PROTECT, related_name='lotes')
    gerado_por = models.CharField('gerado por (no PDF)', max_length=80, blank=True)
    lancado_por = models.ForeignKey(Usuario, models.SET_NULL, null=True, blank=True, related_name='lotes_lancados')
    qtd_guias = models.PositiveIntegerField('guias')
    guias_texto = models.CharField(max_length=20, blank=True)
    valor_total = models.DecimalField('valor', max_digits=14, decimal_places=2)
    competencia = models.CharField('competência', max_length=7)  # AAAA-MM
    periodo_inicio = models.DateField(null=True, blank=True)
    periodo_fim = models.DateField(null=True, blank=True)
    tipo = models.CharField(max_length=60, blank=True)
    prestador = models.CharField(max_length=160, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.LANCADO)
    observacao = models.TextField(blank=True)
    arquivo = models.FileField(upload_to='lotes/', blank=True)
    data_lancamento = models.DateField('lançado em')  # dia da produção do faturista
    demo = models.BooleanField(default=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-data_lancamento', '-id']
        constraints = [models.UniqueConstraint(fields=['numero_lote', 'convenio'], name='lote_unico_por_convenio')]

    def __str__(self):
        return f'{self.numero_lote} · {self.convenio}'

    def amarrar_envios(self):
        """Liga ao lote os protocolos de XML que chegaram antes dele ser lançado."""
        return EnvioXml.objects.filter(lote__isnull=True, numero_lote=self.numero_lote, convenio=self.convenio).update(lote=self)


class EnvioXml(models.Model):
    """Protocolo de envio de XML anexado por quem passa o XML do convênio.
    Sem lote = o protocolo chegou antes e espera o faturista lançar o lote."""
    numero_lote = models.CharField('nº do lote', max_length=40)
    convenio = models.ForeignKey(Convenio, models.PROTECT, related_name='envios_xml')
    lote = models.ForeignKey(Lote, models.SET_NULL, null=True, blank=True, related_name='envios_xml')
    responsavel = models.ForeignKey(Usuario, models.PROTECT, related_name='envios_xml')
    protocolo = models.CharField('protocolo do portal', max_length=60, blank=True)
    data_envio = models.DateField()
    arquivo = models.FileField(upload_to='xml/', blank=True)
    nome_arquivo = models.CharField(max_length=200, blank=True)
    observacao = models.TextField(blank=True)
    demo = models.BooleanField(default=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-data_envio', '-id']
        verbose_name = 'envio de XML'
        verbose_name_plural = 'envios de XML'

    def __str__(self):
        return f'XML {self.numero_lote} · {self.convenio}'
