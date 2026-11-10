# Faturale

Sistema de controle de faturamento da Faturale Consultoria em Saúde, em **Django**.

O faturista envia o protocolo do lote (PDF ou foto) e o sistema lê sozinho o número do lote,
o convênio, as guias, o valor, a competência e **quem gerou** o protocolo. O pessoal do XML anexa
o protocolo do envio e o sistema **amarra ao lote** certo. A coordenação distribui os convênios
(quem fatura, quem passa o XML, se o convênio tem XML) e acompanha a produção.

## Como rodar

Precisa do Python 3.12 ou mais novo. Clique duas vezes em `iniciar.cmd`. Na primeira vez ele
prepara o ambiente (uns minutos); depois abre direto em http://localhost:8000.

Ou, à mão:

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py semear
.venv\Scripts\python.exe manage.py runserver 8000
```

## Banco no Supabase (opcional)

Sem configurar nada, o Faturale usa um banco local (`data/faturale.sqlite3`). Para usar o
Postgres do Supabase:

1. Em https://supabase.com crie um projeto (região **South America (São Paulo)**) e anote a
   senha do banco.
2. No projeto, clique em **Connect** e copie a string do **Session pooler**
   (`postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`).
3. Copie `.env.example` para `.env` e cole a string em `DATABASE_URL`, trocando `[YOUR-PASSWORD]`
   pela senha (se a senha tiver `@`, `#` ou `/`, troque por `%40`, `%23`, `%2F`).
4. Rode `iniciar.cmd`: ele cria as tabelas no Supabase (`migrate`) e a equipe/demonstração (`semear`).

Para levar os dados que já estão no banco local, **antes** do passo 3:

```bash
.venv\Scripts\python.exe manage.py dumpdata faturamento -o data\copia.json
```

e, **depois** do passo 3 (já apontando para o Supabase):

```bash
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py loaddata data\copia.json
```

Os PDFs e protocolos anexados continuam na pasta `data/arquivos` do computador.

## Senhas

Com `FATURALE_MODO_DEMO=0` no `.env`, clicar na pessoa pede a senha. Todo mundo começa com a
**senha inicial** (`FATURALE_SENHA_INICIAL`, padrão `123456`) e é obrigado a criar a própria senha
no primeiro acesso: antes disso o sistema não libera nenhuma tela. Gestão → Usuários → Editar →
**Redefinir a senha** volta a pessoa para a senha inicial (esqueceu a senha). Para pôr a senha
inicial em todos de uma vez: `manage.py senha_inicial` (ou `--login fulano`).

## Entrar (modo demonstração)

A tela inicial mostra a equipe: é só clicar na pessoa, **sem senha**.

| Pessoa    | Perfil          | Abas                                                     |
|-----------|-----------------|----------------------------------------------------------|
| Leandro   | Diretor         | Faturamento, Envio de XML, Gestão, Coordenação, Diretoria |
| Thalita   | Coordenadora    | Faturamento, Envio de XML, Gestão, Coordenação           |
| Larissa   | Supervisora     | Faturamento, Envio de XML, Gestão                        |
| Fabricio, Mister, Stephanie, Emmily, Marlene, Marcos | Faturista / XML | Faturamento, Envio de XML |

Leandro também abre a administração do Django em http://localhost:8000/admin/.

Para exigir usuário e senha: `FATURALE_MODO_DEMO=0` (aí cada pessoa precisa de senha, criada em
Gestão → Usuários ou no admin).

`manage.py semear` cria a equipe, os 57 convênios com a divisão de XML da planilha e os prazos dos
portais do calendário, e ~200 lotes fictícios ("demo") dos últimos meses. Ele só cria o que falta,
então pode rodar de novo sem estragar nada. **Gestão → Lotes da equipe → Apagar dados de
demonstração** tira os lotes fictícios. Para começar do zero, apague a pasta `data/`.

## As abas

- **Faturamento** — envia o protocolo (PDF ou foto), confere o que foi lido e salva. Mostra os
  convênios que a pessoa fatura com o prazo do portal ("aberto hoje" em verde).
- **Envio de XML** — anexa o protocolo do envio (PDF, foto ou o próprio `.xml` do TISS). O sistema
  acha o lote pelo número e amarra. Se o lote ainda não foi lançado, o envio fica **esperando o
  lote** e amarra sozinho quando o faturista lançar. Lista os lotes lançados que ainda esperam XML
  (com "Anexar protocolo" e "Marcar enviado") e o histórico de envios.
- **Calendário** — o calendário de entregas do mês (novembro/2026 já cadastrado a partir do PDF):
  quais convênios entregar em cada dia, feriados, "Próximas entregas" (hoje, amanhã…), os portais
  fixos e as regras do calendário. Cada pessoa marca como entregue o que é dela; "Meus convênios"
  mostra só os seus. A coordenação monta o mês pelo **+** de cada dia (convênio, observação como
  "até as 10h", feriado) e tira com o **×**.
- **Alertas** (topo de todas as telas) — "último dia do portal hoje", "último dia do portal amanhã /
  no próximo dia útil" e "próximo envio do calendário" (quando é no próximo dia útil, avisa para
  entregar hoje ao setor). Faturista vê só os convênios dela; gestão e coordenação, todos.
- **Prazo do portal** — três formatos: *de X a Y*, *dias X e Y* (ex.: Bradesco 9 e 27) ou *até o
  Nº dia útil* (ex.: Assefaz, desconta feriados), com hora opcional. Supervisão e coordenação mudam
  pelo Calendário (clicando no convênio em "Portais fixos") ou na Coordenação.
- **Relatórios** (supervisão, coordenação e diretoria) — aba própria: cada faturista por
  dia/mês/ano, por convênio, competência ou período, CSV e impressão.
- **Tempo real** — a cada 10 s as telas perguntam ao servidor se algo mudou (lote lançado, conferido,
  XML enviado, entrega marcada). Produção, Coordenação, Diretoria, XML e Calendário se atualizam
  sozinhas ("● Ao vivo"); em Faturamento e Gestão aparece o botão "Atualizar", para não recarregar
  no meio de um lançamento ou filtro.
- **Telas que se adaptam** — quando a tabela não cabe (notebook com zoom, tablet, celular), cada
  linha vira um cartão, com os botões embaixo.
- **Protocolo do convênio** — o faturista anexa no Faturamento (cartão "Protocolo do convênio"
  ou botão "Anexar protocolo" no lote). O sistema acha o lote dele e compara o valor na hora.
- **Valor do convênio** — o valor do protocolo do
  convênio é lido do arquivo (dá para corrigir à mão). Se for diferente do valor do lote, o faturista recebe um alerta vermelho e o lote fica
  marcado "Convênio: R$ …"; quando ele corrige, o alerta some. ("XML pendente" = lote lançado, de
  convênio com XML, ainda sem protocolo de envio.)
- **Função de cada pessoa** — no cadastro (Gestão → Usuários): Faturamento, Envio de XML ou as
  duas. Na distribuição dos convênios, "quem fatura" só lista quem fatura e "quem passa o XML" só
  quem passa XML. Quem é só XML não vê a aba Faturamento (e vice-versa).
- **Gestão** — lotes da equipe (conferir, devolver com motivo, editar, excluir, filtro por situação
  do XML) e usuários.
- **Coordenação**
  - *Produção e relatórios*: produção de cada faturista por dia/mês/ano, relatórios por convênio,
    competência, faturista ou período, CSV e impressão.
  - *Convênios e responsáveis*: por convênio, **tem XML (sim/não)**, **quem fatura**, **quem passa o
    XML** e o prazo do portal. Cada mudança salva na hora.
  - *Divisão da equipe*: o mesmo quadro da planilha, uma coluna por pessoa, para imprimir.
- **Diretoria** — mês atual x mesmo trecho do mês anterior, 12 meses, convênios, equipe, lotes
  sem XML enviado.

## Leitura do protocolo

Em [faturamento/extrator.py](faturamento/extrator.py), no modelo do relatório `FatAct_R1`.

- **PDF com texto** (o normal): lê o texto direto — instantâneo e exato.
- **PDF escaneado ou foto**: passa por **OCR** (RapidOCR, roda no próprio computador, sem internet
  depois de instalado). Leva alguns segundos; a tela avisa para conferir os números.

| Campo        | De onde vem                                                         |
|--------------|---------------------------------------------------------------------|
| Nº do lote   | `PROTOCOLO: 361843-BRADESCO` → `361843`                              |
| Convênio     | `Bradesco Saúde (635902)` → nome e código                            |
| Guias        | `Total do protocolo 10/10` → conta o **maior** número                |
| Valor        | maior valor da linha `Total do protocolo`                            |
| Competência  | coluna `Refer` mais frequente (`11/26`)                              |
| Quem gerou   | login do rodapé (`emmily.trindade`) — **mas** se houver um nome colado no protocolo lá em cima (`PROTOCOLO: 365118Larissa`), vale o de cima |

A **produção conta para quem gerou** o protocolo. O sistema liga o nome lido à pessoa da equipe
(`emmily.trindade` → Emmily, `Larissa` → Larissa). Se o nome não estiver cadastrado, a tela avisa e
deixa escolher. Quem subiu o arquivo fica registrado à parte.

Regra das guias: para contar o menor do `X/Y`, rode com `FATURALE_REGRA_GUIAS=menor`.

## Configuração

| Variável                | Padrão  | Para quê                                           |
|-------------------------|---------|----------------------------------------------------|
| `FATURALE_MODO_DEMO`    | `1`     | `0` passa a exigir usuário e senha                 |
| `FATURALE_REGRA_GUIAS`  | `maior` | `maior` ou `menor` no `X/Y` das guias              |
| `DJANGO_SECRET_KEY`     | (demo)  | Trocar antes de usar com dados reais               |
| `DJANGO_DEBUG`          | `1`     | `0` em produção                                    |
| `DJANGO_ALLOWED_HOSTS`  | localhost | Endereços que podem acessar                      |

## Estrutura

```
config/                    configurações do Django
faturamento/models.py      Usuario, Convenio, Lote, EnvioXml
faturamento/views.py       API em JSON usada pelas telas
faturamento/extrator.py    leitura do protocolo (texto e OCR)
faturamento/management/commands/semear.py   equipe, convênios, divisão de XML, prazos, demo
faturamento/static/        telas (JS e CSS sem framework)
data/                      banco SQLite e arquivos enviados (fora do Git)
```
