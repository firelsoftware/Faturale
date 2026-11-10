from django.contrib.auth.models import AbstractUser
from django.db import models


class Usuario(AbstractUser):
    class Perfil(models.TextChoices):
        FATURISTA = 'faturista', 'Faturista / XML'
        SUPERVISORA = 'supervisora', 'Supervisora'
        COORDENADORA = 'coordenadora', 'Coordenadora'
        DIRETOR = 'diretor', 'Diretor'

    perfil = models.CharField(max_length=20, choices=Perfil.choices, default=Perfil.FATURISTA)
    # Para a equipe (perfil faturista): o que a pessoa faz. A coordenação define no cadastro.
    class Funcao(models.TextChoices):
        FATURAMENTO = 'faturamento', 'Faturamento'
        XML = 'xml', 'Envio de XML'
        AMBOS = 'ambos', 'Faturamento e XML'

    funcao = models.CharField('função', max_length=12, choices=Funcao.choices, default=Funcao.AMBOS)

    # Senha inicial (ou redefinida pela gestão): obriga a trocar no próximo acesso
    trocar_senha = models.BooleanField('trocar a senha no próximo acesso', default=True)

    # Abas que cada perfil enxerga. A diretoria vê tudo.
    ABAS = {
        'faturista': ['faturamento', 'xml', 'calendario'],
        'supervisora': ['faturamento', 'xml', 'calendario', 'gestao', 'producao'],
        'coordenadora': ['faturamento', 'xml', 'calendario', 'gestao', 'producao', 'coordenacao'],
        'diretor': ['faturamento', 'xml', 'calendario', 'gestao', 'producao', 'coordenacao', 'diretoria'],
    }

    @property
    def nome(self):
        return self.first_name or self.username

    @property
    def faz_faturamento(self):
        return self.perfil != 'faturista' or self.funcao in ('faturamento', 'ambos')

    @property
    def faz_xml(self):
        return self.perfil != 'faturista' or self.funcao in ('xml', 'ambos')

    @property
    def abas(self):
        abas = list(self.ABAS.get(self.perfil, []))
        if self.perfil == 'faturista':  # quem só passa XML não vê Faturamento, e vice-versa
            if not self.faz_faturamento:
                abas.remove('faturamento')
            if not self.faz_xml:
                abas.remove('xml')
        return abas

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
    # Prazo do portal. Ver faturamento/prazos.py: "de X a Y", "dias X e Y", "até o Nº dia útil" ou texto livre.
    prazo_tipo = models.CharField(max_length=10, default='livre',
                                  choices=[('intervalo', 'De … a …'), ('dias', 'Dias específicos'),
                                           ('dia_util', 'Até o Nº dia útil'), ('livre', 'Outro (texto)')])
    prazo_inicio = models.PositiveSmallIntegerField('abre no dia', null=True, blank=True)
    prazo_fim = models.PositiveSmallIntegerField('fecha no dia', null=True, blank=True)
    prazo_dias = models.CharField('dias específicos', max_length=80, blank=True)  # "9,27"
    prazo_dia_util = models.PositiveSmallIntegerField('até o Nº dia útil', null=True, blank=True)
    prazo_hora = models.CharField('até que horas', max_length=10, blank=True)  # "17h"
    prazo_texto = models.CharField('prazo do portal', max_length=80, blank=True)  # como aparece na tela

    class Meta:
        ordering = ['nome']
        verbose_name = 'convênio'

    def __str__(self):
        return self.nome

    @property
    def dias_lista(self):
        from .prazos import ler_dias
        return ler_dias(self.prazo_dias)

    def definir_prazo(self, tipo, inicio=None, fim=None, dias=None, dia_util=None, hora='', livre=''):
        """Grava o prazo e o texto que aparece na tela."""
        from .prazos import descrever, ler_dias
        self.prazo_tipo = tipo if tipo in ('intervalo', 'dias', 'dia_util', 'livre') else 'livre'
        self.prazo_inicio = inicio if self.prazo_tipo == 'intervalo' else None
        self.prazo_fim = fim if self.prazo_tipo == 'intervalo' else None
        lista = ler_dias(dias) if not isinstance(dias, list) else dias
        self.prazo_dias = ','.join(map(str, lista)) if self.prazo_tipo == 'dias' else ''
        self.prazo_dia_util = dia_util if self.prazo_tipo == 'dia_util' else None
        self.prazo_hora = (hora or '').strip() if self.prazo_tipo != 'livre' else ''
        self.prazo_texto = descrever(self.prazo_tipo, self.prazo_inicio, self.prazo_fim, self.dias_lista,
                                     self.prazo_dia_util, self.prazo_hora, livre)[:80]

    def aberto_em(self, dia, feriados=()):
        from .prazos import aberto
        return aberto(self.prazo_tipo, dia, self.prazo_inicio, self.prazo_fim, self.dias_lista, self.prazo_dia_util, feriados)


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
    # Valor que está no protocolo do convênio. Se for diferente do valor do lote, o faturista é avisado.
    valor_protocolo = models.DecimalField('valor no protocolo do convênio', max_digits=14, decimal_places=2, null=True, blank=True)
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


class EntregaCalendario(models.Model):
    """Um convênio a entregar num dia do calendário de faturamento.
    A fatura vai para o setor pelo menos 1 dia antes (regra 2 do calendário)."""
    data = models.DateField()
    convenio = models.ForeignKey(Convenio, models.CASCADE, related_name='entregas')
    observacao = models.CharField('observação', max_length=80, blank=True)  # "até as 10h", "Periódico"…
    concluido = models.BooleanField('entregue', default=False)
    concluido_por = models.ForeignKey(Usuario, models.SET_NULL, null=True, blank=True, related_name='+')
    concluido_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['data', 'id']
        verbose_name = 'entrega do calendário'
        verbose_name_plural = 'calendário de entregas'
        constraints = [models.UniqueConstraint(fields=['data', 'convenio', 'observacao'], name='entrega_unica_no_dia')]

    def __str__(self):
        return f'{self.data:%d/%m} · {self.convenio}'


class Feriado(models.Model):
    data = models.DateField(unique=True)
    descricao = models.CharField('descrição', max_length=80, default='Feriado')

    class Meta:
        ordering = ['data']

    def __str__(self):
        return f'{self.data:%d/%m} · {self.descricao}'
