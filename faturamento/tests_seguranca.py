"""Testes de segurança: cada um prova que um ataque NÃO funciona."""
import json
import tempfile
from datetime import date
from unittest import mock

from django.core.cache import cache
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from .models import Convenio, EnvioXml, Lote, Usuario


@override_settings(FATURALE_MODO_DEMO=False)
class SegurancaTests(TestCase):
    def setUp(self):
        cache.clear()
        mk = lambda login, perfil: Usuario.objects.create_user(login, password='Senha-Forte-123', first_name=login.title(),
                                                                perfil=perfil, trocar_senha=False)
        self.coord = mk('thalita', 'coordenadora')
        self.sup = mk('larissa', 'supervisora')
        self.fat_a = mk('ana.souza', 'faturista')
        self.fat_b = mk('bia.lima', 'faturista')
        self.conv = Convenio.objects.create(nome='Bradesco')
        self.lote_b = Lote.objects.create(numero_lote='999', convenio=self.conv, faturista=self.fat_b, qtd_guias=3,
                                          valor_total=100, data_lancamento=date.today(), competencia='2026-11')

    def post(self, url, dados):
        return self.client.post(url, json.dumps(dados), content_type='application/json')

    # ---------- Exposição de dados ----------
    def test_lista_publica_de_logins_foi_removida(self):
        self.assertEqual(self.client.get('/api/entrar/pessoas').status_code, 404)

    def test_painel_admin_fechado(self):
        self.assertEqual(self.client.get('/admin/login/').status_code, 404)

    def test_publico_nao_mostra_login(self):
        dados = self.client.get('/api/publico/pessoas').json()
        self.assertTrue(dados)
        self.assertFalse(any('login' in p or 'username' in p or 'email' in p for p in dados))

    def test_apis_exigem_login(self):
        for url in ['/api/lotes', '/api/usuarios', '/api/relatorios', '/api/relatorios/csv', '/api/mensagens',
                    '/api/minha-producao', '/api/xml', f'/api/lotes/{self.lote_b.id}/pdf', '/api/eu']:
            self.assertEqual(self.client.get(url).status_code, 401, url)

    # ---------- Controle de acesso ----------
    def test_faturista_nao_mexe_no_lote_de_outra(self):
        self.client.force_login(self.fat_a)
        self.assertEqual(self.client.delete(f'/api/lotes/{self.lote_b.id}').status_code, 403)
        self.assertEqual(self.client.get(f'/api/lotes/{self.lote_b.id}/pdf').status_code, 403)
        self.assertNotIn('999', [l['numero_lote'] for l in self.client.get('/api/lotes').json()])
        self.assertNotIn('999', self.client.get('/api/relatorios/csv').content.decode())
        self.assertTrue(Lote.objects.filter(pk=self.lote_b.id).exists())

    def test_faturista_nao_acessa_gestao(self):
        self.client.force_login(self.fat_a)
        self.assertEqual(self.client.get('/api/usuarios').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/usuarios/{self.fat_b.id}').status_code, 403)
        self.assertEqual(self.client.get('/api/relatorios/equipe').status_code, 403)
        r = self.client.put(f'/api/usuarios/{self.fat_a.id}', json.dumps({'perfil': 'diretor', 'ativo': True}),
                            content_type='application/json')
        self.assertEqual(r.status_code, 403)
        self.fat_a.refresh_from_db()
        self.assertEqual(self.fat_a.perfil, 'faturista')

    def test_supervisao_nao_se_promove_nem_mexe_na_coordenacao(self):
        self.client.force_login(self.sup)
        r = self.client.put(f'/api/usuarios/{self.sup.id}', json.dumps({'perfil': 'diretor', 'ativo': True}),
                            content_type='application/json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.client.delete(f'/api/usuarios/{self.coord.id}').status_code, 403)

    def test_cadastro_nao_escolhe_perfil(self):
        r = self.post('/api/cadastro', {'nome': 'Eva Melo', 'login': 'eva.melo', 'senha': 'Faturale#2026x',
                                        'confirmacao': 'Faturale#2026x', 'faturista': 'sim', 'perfil': 'diretor'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Usuario.objects.get(username='eva.melo').perfil, 'faturista')

    # ---------- Senhas ----------
    def test_limite_de_tentativas_de_login(self):
        for _ in range(5):
            self.assertEqual(self.post('/api/entrar', {'login': 'thalita', 'senha': 'errada'}).status_code, 401)
        # 6ª tentativa: bloqueada, mesmo com a senha certa
        self.assertEqual(self.post('/api/entrar', {'login': 'thalita', 'senha': 'Senha-Forte-123'}).status_code, 429)

    def test_senha_fraca_recusada(self):
        for fraca in ['12345678', 'password', 'abc', 'joaosilva1']:
            r = self.post('/api/cadastro', {'nome': 'Joao Silva', 'login': 'joao.silva', 'senha': fraca,
                                            'confirmacao': fraca, 'faturista': 'sim'})
            self.assertEqual(r.status_code, 400, fraca)
        self.assertFalse(Usuario.objects.filter(username='joao.silva').exists())

    def test_gestao_cria_usuario_com_senha_temporaria_aleatoria(self):
        self.client.force_login(self.coord)
        r = self.post('/api/usuarios', {'nome': 'Caio Reis', 'login': 'caio.reis', 'perfil': 'faturista'}).json()
        u = Usuario.objects.get(username='caio.reis')
        self.assertNotEqual(r['senhaTemporaria'], '123456')
        self.assertFalse(u.check_password('123456'))
        self.assertTrue(u.check_password(r['senhaTemporaria']))
        self.assertTrue(u.trocar_senha)
        # redefinir também gera uma nova (diferente)
        r2 = self.client.put(f'/api/usuarios/{u.id}', json.dumps({'nome': 'Caio Reis', 'perfil': 'faturista', 'ativo': True,
                                                                   'redefinir': True}), content_type='application/json').json()
        self.assertNotEqual(r2['senhaTemporaria'], r['senhaTemporaria'])
        u.refresh_from_db()
        self.assertTrue(u.check_password(r2['senhaTemporaria']))

    def test_senha_temporaria_so_serve_para_trocar(self):
        self.client.force_login(self.coord)
        r = self.post('/api/usuarios', {'nome': 'Caio Reis', 'login': 'caio.reis', 'perfil': 'faturista'}).json()
        self.client.logout()
        self.assertEqual(self.post('/api/entrar', {'login': 'caio.reis', 'senha': r['senhaTemporaria']}).status_code, 200)
        self.assertEqual(self.client.get('/api/lotes').status_code, 428)  # tem que trocar antes de usar
        self.assertEqual(self.post('/api/senha', {'atual': r['senhaTemporaria'], 'nova': '123456', 'confirmacao': '123456'}).status_code, 400)
        ok = self.post('/api/senha', {'atual': r['senhaTemporaria'], 'nova': 'Minha-Senha-77', 'confirmacao': 'Minha-Senha-77'})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.client.get('/api/lotes').status_code, 200)

    def test_comando_troca_quem_ainda_tem_a_senha_padrao(self):
        from io import StringIO
        from django.core.management import call_command
        velho = Usuario.objects.create_user('velho.user', password='123456', first_name='Velho', perfil='faturista')
        saida = StringIO()
        call_command('senhas_temporarias', stdout=saida)
        velho.refresh_from_db()
        self.assertFalse(velho.check_password('123456'))
        self.assertTrue(velho.trocar_senha)
        self.assertIn('velho.user', saida.getvalue())
        self.coord.refresh_from_db()
        self.assertTrue(self.coord.check_password('Senha-Forte-123'))  # quem já tem senha própria não muda

    # ---------- Arquivos enviados ----------
    @override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix='faturale-teste-'))
    def test_arquivo_xml_nao_abre_como_pagina(self):
        """Um XML com script, enviado com nome 'x.html', não pode abrir como página no sistema (XSS)."""
        self.client.force_login(self.fat_a)
        e = EnvioXml.objects.create(numero_lote='1', convenio=self.conv, responsavel=self.fat_a, data_envio=date.today(),
                                    nome_arquivo='ataque.html')
        e.arquivo.save('xml-1.xml', ContentFile(b'<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>'))
        r = self.client.get(f'/api/xml/{e.id}/arquivo')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/octet-stream')
        self.assertTrue(r['Content-Disposition'].startswith('attachment'))
        self.assertNotIn('.html', r['Content-Disposition'].split('filename')[-1].replace('.html.xml', ''))
        self.assertIn('sandbox', r['Content-Security-Policy'])
        r.close()

    # ---------- Cabeçalhos ----------
    def test_cabecalhos_de_seguranca(self):
        r = self.client.get('/')
        csp = r['Content-Security-Policy']
        self.assertIn("script-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertEqual(r['X-Frame-Options'], 'DENY')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertIn('camera=()', r['Permissions-Policy'])
        self.client.force_login(self.fat_a)
        self.assertEqual(self.client.get('/api/lotes')['Cache-Control'], 'no-store')

    def test_cadastro_tem_limite_por_ip(self):
        for i in range(10):
            r = self.post('/api/cadastro', {'nome': f'Pessoa Teste{i}', 'login': f'pessoa.teste{i}', 'senha': 'Faturale#2026x',
                                            'confirmacao': 'Faturale#2026x', 'faturista': 'nao'})
            self.assertEqual(r.status_code, 200, i)
        r = self.post('/api/cadastro', {'nome': 'Pessoa Extra', 'login': 'pessoa.extra', 'senha': 'Faturale#2026x',
                                        'confirmacao': 'Faturale#2026x', 'faturista': 'nao'})
        self.assertEqual(r.status_code, 429)


class ConfiguracaoTests(TestCase):
    def test_producao_sem_chave_nao_sobe(self):
        import importlib
        import config.settings as s
        from django.core.exceptions import ImproperlyConfigured
        with mock.patch.dict('os.environ', {'DJANGO_DEBUG': '0', 'DJANGO_SECRET_KEY': ''}):
            with self.assertRaises(ImproperlyConfigured):
                importlib.reload(s)
        with mock.patch.dict('os.environ', {'DJANGO_DEBUG': '0', 'DJANGO_SECRET_KEY': 'x' * 50, 'FATURALE_MODO_DEMO': '1'}):
            with self.assertRaises(ImproperlyConfigured):
                importlib.reload(s)
        importlib.reload(s)
