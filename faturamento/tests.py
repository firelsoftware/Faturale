import json
from datetime import date

from django.test import TestCase, override_settings

from .models import Convenio, Lote, Usuario


@override_settings(FATURALE_MODO_DEMO=False)
class CadastroTests(TestCase):
    def setUp(self):
        self.thalita = Usuario.objects.create_user('thalita', password='senhaT1', first_name='Thalita', perfil='coordenadora')
        self.larissa = Usuario.objects.create_user('larissa', password='senhaL1', first_name='Larissa', perfil='supervisora')
        self.leandro = Usuario.objects.create_user('leandro', password='senhaD1', first_name='Leandro', perfil='diretor')
        Usuario.objects.update(trocar_senha=False)

    def post(self, url, dados, cliente=None):
        return (cliente or self.client).post(url, json.dumps(dados), content_type='application/json')

    def cadastro(self, login, faturista, **extra):
        return self.post('/api/cadastro', {'nome': f'Pessoa {login}', 'login': login, 'senha': 'abc123x',
                                           'confirmacao': 'abc123x', 'faturista': faturista, **extra})

    def test_faturista_entra_na_hora_com_padrao_de_producao(self):
        r = self.cadastro('maria.silva', 'sim')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['entrou'])
        u = Usuario.objects.get(username='maria.silva')
        self.assertTrue(u.is_active)
        self.assertFalse(u.aguardando_liberacao)
        self.assertEqual((u.perfil, u.funcao), ('faturista', 'faturamento'))
        self.assertEqual(self.client.get('/api/eu').status_code, 200)  # já está logada
        self.assertIn('faturamento', self.client.get('/api/eu').json()['abas'])

    def test_nao_faturista_aguarda_e_coordenacao_recebe_aviso(self):
        r = self.cadastro('joao.souza', 'nao')
        self.assertTrue(r.json()['aguardandoPerfil'])
        u = Usuario.objects.get(username='joao.souza')
        self.assertFalse(u.is_active)
        self.assertTrue(u.aguardando_liberacao)
        r = self.post('/api/entrar', {'login': 'joao.souza', 'senha': 'abc123x'})
        self.assertEqual(r.status_code, 403)
        self.assertIn('perfil', r.json()['erro'])
        self.client.force_login(self.thalita)
        alertas = self.client.get('/api/alertas').json()['alertas']
        self.assertTrue(any('escolha de perfil' in a['titulo'] and 'Pessoa joao.souza' in a['itens'] for a in alertas))

    def test_precisa_responder_a_pergunta(self):
        self.assertEqual(self.cadastro('ana', '').status_code, 400)

    def test_usuario_nao_repete(self):
        self.cadastro('maria.silva', 'sim')
        self.client.logout()
        self.assertEqual(self.cadastro('maria.silva', 'sim').status_code, 409)
        self.assertEqual(self.cadastro('MARIA.SILVA', 'nao').status_code, 409)  # vira minúscula: é o mesmo usuário
        self.assertEqual(Usuario.objects.filter(username='maria.silva').count(), 1)
        ids = set(Usuario.objects.values_list('id', flat=True))
        self.assertEqual(len(ids), Usuario.objects.count())  # cada um com o seu id

    def test_thalita_e_larissa_excluem(self):
        a = Usuario.objects.create_user('a1', password='x', perfil='faturista', first_name='A')
        b = Usuario.objects.create_user('b1', password='x', perfil='faturista', first_name='B')
        self.client.force_login(self.thalita)
        self.assertEqual(self.client.delete(f'/api/usuarios/{a.id}').status_code, 200)
        self.client.force_login(self.larissa)
        self.assertEqual(self.client.delete(f'/api/usuarios/{b.id}').status_code, 200)
        self.assertFalse(Usuario.objects.filter(username__in=['a1', 'b1']).exists())

    def test_regras_da_exclusao(self):
        fat = Usuario.objects.create_user('fat', password='x', perfil='faturista', first_name='Fat', trocar_senha=False)
        # faturista não exclui ninguém
        self.client.force_login(fat)
        self.assertEqual(self.client.delete(f'/api/usuarios/{self.larissa.id}').status_code, 403)
        # supervisão não exclui a coordenação; ninguém exclui a si mesmo
        self.client.force_login(self.larissa)
        self.assertEqual(self.client.delete(f'/api/usuarios/{self.thalita.id}').status_code, 403)
        self.client.force_login(self.thalita)
        self.assertEqual(self.client.delete(f'/api/usuarios/{self.thalita.id}').status_code, 400)
        # quem tem produção não é excluído (protege os relatórios)
        c = Convenio.objects.create(nome='Teste')
        Lote.objects.create(numero_lote='1', convenio=c, faturista=fat, qtd_guias=1, valor_total=10,
                            data_lancamento=date.today(), competencia='2026-11')
        r = self.client.delete(f'/api/usuarios/{fat.id}')
        self.assertEqual(r.status_code, 409)
        self.assertIn('Desative', r.json()['erro'])
        self.assertTrue(Usuario.objects.filter(pk=fat.pk).exists())

    def test_nome_e_sobrenome_e_usuario_nome_ponto_sobrenome(self):
        r = self.post('/api/cadastro', {'nome': 'Fabrício', 'login': 'fabricio.alves', 'senha': 'abc123x', 'confirmacao': 'abc123x', 'faturista': 'sim'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('sobrenome', r.json()['erro'])
        r = self.post('/api/cadastro', {'nome': 'Fabrício Alves', 'login': 'fabricio', 'senha': 'abc123x', 'confirmacao': 'abc123x', 'faturista': 'sim'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('nome.sobrenome', r.json()['erro'])
        r = self.post('/api/cadastro', {'nome': 'Fabrício Alves', 'login': 'fabricio.alves', 'senha': 'abc123x', 'confirmacao': 'abc123x', 'faturista': 'sim'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['nome'], 'Fabrício Alves')

    def test_lancar_producao_com_unidade_e_sem_valor(self):
        c = Convenio.objects.create(nome='Bradesco')
        fat = Usuario.objects.create_user('fabricio.alves', password='x', perfil='faturista', first_name='Fabrício Alves', trocar_senha=False)
        self.client.force_login(fat)
        r = self.post('/api/lotes', {'numeroLote': '365118', 'convenioId': c.id, 'qtdGuias': 0, 'valorTotal': 0, 'unidade': 'DF Star',
                                     'competencia': '2026-11', 'dataLancamento': '2026-11-24', 'faturistaId': fat.id})
        self.assertEqual(r.status_code, 200, r.content)
        l = Lote.objects.get(numero_lote='365118')
        self.assertEqual((l.unidade, l.faturista, float(l.valor_total)), ('DF Star', fat, 0.0))
        self.assertEqual(self.client.get('/api/lotes').json()[0]['unidade'], 'DF Star')
