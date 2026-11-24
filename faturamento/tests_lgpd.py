"""Testes LGPD: minimização na consulta sem login, Meus dados, pedidos do titular, anonimização e descarte."""
import json
from datetime import date, timedelta
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Convenio, DuvidaConvenio, Lote, Mensagem, SolicitacaoTitular, Usuario


@override_settings(FATURALE_MODO_DEMO=False)
class LgpdTests(TestCase):
    def setUp(self):
        cache.clear()
        mk = lambda login, perfil, nome: Usuario.objects.create_user(login, password='Senha-Forte-123', first_name=nome,
                                                                      perfil=perfil, trocar_senha=False, email=f'{login}@x.com')
        self.ti = mk('fabricio.alves', 'ti', 'Fabrício Alves')
        self.coord = mk('thalita', 'coordenadora', 'Thalita Souza')
        self.fat = mk('ana.souza', 'faturista', 'Ana Souza')
        self.outra = mk('bia.lima', 'faturista', 'Bia Lima')
        self.conv = Convenio.objects.create(nome='Cassi', faturista=self.fat, responsavel_xml=self.outra)
        self.lote = Lote.objects.create(numero_lote='111', convenio=self.conv, faturista=self.fat, qtd_guias=4,
                                        valor_total=50, data_lancamento=date.today(), competencia='2026-11')
        Lote.objects.create(numero_lote='222', convenio=self.conv, faturista=self.outra, qtd_guias=1,
                            valor_total=9, data_lancamento=date.today(), competencia='2026-11')

    def post(self, url, dados):
        return self.client.post(url, json.dumps(dados), content_type='application/json')

    # ---------- Consulta sem login: sem nomes da equipe ----------
    def test_publico_nao_lista_equipe(self):
        self.assertEqual(self.client.get('/api/publico/pessoas').json(), [])

    def test_publico_convenios_sem_nomes(self):
        c = self.client.get('/api/publico/convenios').json()[0]
        self.assertIsNone(c['faturista'])
        self.assertIsNone(c['responsavel_xml'])
        self.assertNotIn('Ana Souza', json.dumps(c, ensure_ascii=False))

    def test_publico_duvidas_sem_nome_de_quem_perguntou(self):
        DuvidaConvenio.objects.create(convenio=self.conv, autor=self.fat, texto='Precisa de senha?', resposta='Sim',
                                      respondida_por=self.coord, respondida_em=timezone.now())
        DuvidaConvenio.objects.create(convenio=self.conv, autor_nome='Fulano de Tal', texto='E o prazo?')
        txt = self.client.get(f'/api/publico/duvidas?convenio={self.conv.id}').content.decode()
        for nome in ('Ana Souza', 'Thalita', 'Fulano'):
            self.assertNotIn(nome, txt)

    def test_logado_continua_vendo_nomes(self):
        self.client.force_login(self.fat)
        c = self.client.get('/api/convenios').json()[0]
        self.assertEqual(c['faturista'], 'Ana Souza')

    # ---------- Política de Privacidade ----------
    def test_politica_publica_com_pendencias(self):
        r = self.client.get('/politica-de-privacidade/')
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn('Política de Privacidade', html)
        self.assertIn('[PENDENTE: CNPJ]', html)
        self.assertIn('sessionid', html)

    def test_politica_usa_dados_do_controlador_quando_configurados(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {'FATURALE_CONTROLADOR_CNPJ': '00.000.000/0001-00'}):
            html = self.client.get('/politica-de-privacidade/').content.decode()
        self.assertIn('00.000.000/0001-00', html)
        self.assertNotIn('[PENDENTE: CNPJ]', html)

    def test_link_da_politica_no_login(self):
        self.assertIn('/politica-de-privacidade/', self.client.get('/').content.decode())

    # ---------- Meus dados ----------
    def test_meus_dados_exige_login(self):
        for url in ['/api/meus-dados', '/api/solicitacoes']:
            self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.post('/api/meus-dados/exportar', {'senha': 'x'}).status_code, 401)

    def test_ver_e_corrigir_os_proprios_dados(self):
        self.client.force_login(self.fat)
        d = self.client.get('/api/meus-dados').json()
        self.assertEqual(d['conta']['usuario'], 'ana.souza')
        self.assertEqual(d['contagem']['lotes'], 1)
        r = self.post('/api/meus-dados', {'nome': 'Ana Souza Lima', 'email': 'ana@novo.com'})
        self.assertEqual(r.status_code, 200)
        self.fat.refresh_from_db()
        self.assertEqual((self.fat.first_name, self.fat.email, self.fat.username), ('Ana Souza Lima', 'ana@novo.com', 'ana.souza'))
        self.assertEqual(self.post('/api/meus-dados', {'nome': 'Ana'}).status_code, 400)
        self.assertEqual(self.post('/api/meus-dados', {'nome': 'Ana Souza', 'email': 'ruim'}).status_code, 400)

    def test_exportar_exige_senha_e_so_traz_o_proprio(self):
        Mensagem.objects.create(autor=self.fat, destinatario=self.outra, texto='oi')
        Mensagem.objects.create(autor=self.outra, destinatario=self.fat, texto='segredo da Bia')
        self.client.force_login(self.fat)
        self.assertEqual(self.post('/api/meus-dados/exportar', {'senha': 'errada'}).status_code, 403)
        r = self.post('/api/meus-dados/exportar', {'senha': 'Senha-Forte-123'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('attachment', r['Content-Disposition'])
        d = json.loads(r.content)
        self.assertEqual([l['numero_lote'] for l in d['lotes_lancados']], ['111'])
        self.assertEqual([m['texto'] for m in d['mensagens_enviadas']], ['oi'])
        self.assertNotIn('segredo da Bia', r.content.decode())
        self.assertNotIn('password', r.content.decode())

    def test_exportar_bloqueia_apos_tentativas(self):
        self.client.force_login(self.fat)
        for _ in range(5):
            self.post('/api/meus-dados/exportar', {'senha': 'errada'})
        self.assertEqual(self.post('/api/meus-dados/exportar', {'senha': 'Senha-Forte-123'}).status_code, 429)

    # ---------- Pedidos do titular ----------
    def test_pedido_registrado_e_respondido_pelo_ti(self):
        self.client.force_login(self.fat)
        self.assertEqual(self.post('/api/solicitacoes', {'tipo': 'correcao', 'senha': 'errada'}).status_code, 403)
        self.assertEqual(self.post('/api/solicitacoes', {'tipo': 'xyz', 'senha': 'Senha-Forte-123'}).status_code, 400)
        r = self.post('/api/solicitacoes', {'tipo': 'correcao', 'descricao': 'meu e-mail', 'senha': 'Senha-Forte-123'})
        self.assertEqual(r.status_code, 200)
        pk = r.json()['id']
        # outra faturista não vê nem responde
        self.client.force_login(self.outra)
        self.assertEqual(self.client.get('/api/solicitacoes').json(), [])
        self.assertEqual(self.post(f'/api/solicitacoes/{pk}', {'situacao': 'atendida', 'resposta': 'ok'}).status_code, 403)
        # coordenação também não responde (só o TI)
        self.client.force_login(self.coord)
        self.assertEqual(self.post(f'/api/solicitacoes/{pk}', {'situacao': 'atendida', 'resposta': 'ok'}).status_code, 403)
        self.client.force_login(self.ti)
        self.assertEqual(len(self.client.get('/api/solicitacoes').json()), 1)
        self.assertEqual(self.post(f'/api/solicitacoes/{pk}', {'situacao': 'atendida'}).status_code, 400)
        self.assertEqual(self.post(f'/api/solicitacoes/{pk}', {'situacao': 'atendida', 'resposta': 'Corrigido.'}).status_code, 200)
        s = SolicitacaoTitular.objects.get(pk=pk)
        self.assertEqual((s.situacao, s.respondida_por), ('atendida', self.ti))
        self.client.force_login(self.fat)
        self.assertEqual(self.client.get('/api/meus-dados').json()['solicitacoes'][0]['resposta'], 'Corrigido.')

    def test_log_do_pedido_nao_traz_o_texto(self):
        self.client.force_login(self.fat)
        with self.assertLogs('faturale.seguranca', 'INFO') as cm:
            self.post('/api/solicitacoes', {'tipo': 'outro', 'descricao': 'texto pessoal sigiloso', 'senha': 'Senha-Forte-123'})
        self.assertNotIn('sigiloso', ' '.join(cm.output))

    # ---------- Anonimização ----------
    def test_anonimizar_so_ti_com_confirmacao_e_mantem_producao(self):
        DuvidaConvenio.objects.create(convenio=self.conv, autor=self.fat, autor_nome='Ana', texto='?')
        self.client.force_login(self.coord)
        self.assertEqual(self.post(f'/api/usuarios/{self.fat.id}/anonimizar', {'confirmacao': 'ANONIMIZAR'}).status_code, 403)
        self.client.force_login(self.ti)
        self.assertEqual(self.post(f'/api/usuarios/{self.fat.id}/anonimizar', {'confirmacao': 'sim'}).status_code, 400)
        self.assertEqual(self.post(f'/api/usuarios/{self.ti.id}/anonimizar', {'confirmacao': 'ANONIMIZAR'}).status_code, 400)
        self.assertEqual(self.post(f'/api/usuarios/{self.fat.id}/anonimizar', {'confirmacao': 'ANONIMIZAR'}).status_code, 200)
        self.fat.refresh_from_db()
        self.assertEqual(self.fat.username, f'removido.{self.fat.id}')
        self.assertEqual(self.fat.email, '')
        self.assertFalse(self.fat.is_active)
        self.assertFalse(self.fat.has_usable_password())
        self.assertTrue(Lote.objects.filter(pk=self.lote.id, faturista=self.fat).exists())  # produção fica
        self.assertEqual(DuvidaConvenio.objects.get(autor=self.fat).autor_nome, '')
        self.assertEqual(self.post(f'/api/usuarios/{self.fat.id}/anonimizar', {'confirmacao': 'ANONIMIZAR'}).status_code, 400)

    # ---------- Descarte ----------
    def test_descarte_simula_por_padrao(self):
        m = Mensagem.objects.create(autor=self.fat, texto='antiga')
        Mensagem.objects.filter(pk=m.pk).update(criado_em=timezone.now() - timedelta(days=400))
        Mensagem.objects.create(autor=self.fat, texto='nova')
        out = StringIO()
        call_command('descartar_dados', '--mensagens-dias', '365', stdout=out)
        self.assertIn('SIMULAÇÃO', out.getvalue())
        self.assertIn('mensagens = 1', out.getvalue())
        self.assertEqual(Mensagem.objects.count(), 2)
        call_command('descartar_dados', '--mensagens-dias', '365', '--executar', stdout=StringIO())
        self.assertEqual(list(Mensagem.objects.values_list('texto', flat=True)), ['nova'])

    def test_descarte_sem_prazo_nao_apaga_nada(self):
        Mensagem.objects.create(autor=self.fat, texto='x')
        out = StringIO()
        call_command('descartar_dados', '--executar', stdout=out)
        self.assertIn('Nenhum prazo informado', out.getvalue())
        self.assertEqual(Mensagem.objects.count(), 1)
