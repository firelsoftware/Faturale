# Segurança do Faturale

## Proteções em vigor

| Área | Proteção |
|---|---|
| Senhas | Hash PBKDF2-SHA256 (padrão do Django). Mínimo de 8 caracteres; recusa senhas comuns, só números ou parecidas com o nome. |
| Primeiro acesso | Senha temporária aleatória (gerada pelo sistema, mostrada uma vez para a gestão). A pessoa é obrigada a criar a dela antes de usar qualquer tela. |
| Login | Limite de 5 erros por usuário e 20 por IP a cada 15 minutos (HTTP 429). Cadastro: 10 por IP por hora. Troca de senha: 5 erros por 15 minutos. |
| Sessão | Cookie `Secure`, `HttpOnly`, `SameSite=Lax`; expira em 12 h; ao redefinir a senha, a sessão aberta da pessoa é derrubada. |
| CSRF | Middleware do Django em todas as ações (o front envia `X-CSRFToken`). |
| Permissões | Cada rota exige login e a aba do perfil; lotes, XML e relatórios só mostram o que a pessoa pode ver (faturista vê só a própria produção). Ninguém se promove de perfil. |
| Arquivos enviados | Tipos aceitos: PDF, XML, PNG, JPG (até 20 MB). Ao baixar, o tipo vem do arquivo guardado; o que não é PDF/imagem baixa como arquivo, com `CSP: sandbox`, e não abre como página. |
| Cabeçalhos | CSP (scripts só do próprio sistema), HSTS (1 ano), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-*`, `Cache-Control: no-store` nas APIs. |
| HTTPS | Obrigatório (Fly força HTTPS e o Django redireciona). |
| Configuração | Em produção o sistema não sobe sem `DJANGO_SECRET_KEY` forte; o modo demonstração (entrar sem senha) é recusado fora do computador local; `/admin/` fechado (abre só com `FATURALE_ADMIN=1`). |
| Banco | Postgres no Supabase com RLS ligado em todas as tabelas (a API pública do Supabase não lê os dados); senha do banco só nos segredos do Fly. |
| Registro | Entradas, falhas, bloqueios, cadastros e trocas de senha vão para o log do servidor (`flyctl logs`), sem senha nenhuma. |
| Aviso | A gestão vê um alerta com quem se cadastrou como faturista nos últimos 3 dias, para conferir se é da equipe. |

## Procedimentos

**Alguém esqueceu a senha:** Gestão → Usuários → Editar → *Gerar uma senha temporária nova*. Passe a senha só para a própria pessoa.

**Gerar senhas temporárias pelo terminal:**
`flyctl ssh console --app faturale-firel -C 'python /app/manage.py senhas_temporarias --login fulano'`

**Suspeita de acesso indevido:**
1. Gestão → Usuários → desmarque *Usuário ativo* da conta (ou gere senha temporária nova).
2. Veja o log: `flyctl logs --app faturale-firel` (procure `login falhou`, `login bloqueado`, `cadastro novo`).
3. Se a senha do banco ou a chave do sistema puderem ter vazado: troque a senha do banco no Supabase e atualize
   `flyctl secrets set DATABASE_URL=... DJANGO_SECRET_KEY=... --app faturale-firel` (todos precisam entrar de novo).

**Atualizar dependências (uma vez por mês):**
`pip-audit -r requirements.txt` e `python manage.py test faturamento` antes de publicar.

**Testes de segurança:** `python manage.py test faturamento` roda os testes de `faturamento/tests_seguranca.py`
(acesso de outros usuários, limite de tentativas, senhas, arquivos, cabeçalhos).
