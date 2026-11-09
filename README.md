# Faturale

Sistema de controle de faturamento da Faturale Consultoria em Saúde.
O faturista envia o PDF do lote/protocolo do convênio e o sistema lê sozinho o número do lote,
o convênio, a quantidade de guias, o valor total e a competência. A coordenação e a diretoria
acompanham a produção e tiram relatórios.

## Como rodar

Precisa do Node.js 22.13 ou mais novo (o banco SQLite já vem dentro do Node).

Clique duas vezes em `iniciar.cmd`, ou:

```bash
npm install
npm start
```

Abre em http://localhost:3000.

## Usuários de teste

Todos com a senha `faturale`. Na tela de login também aparece o **acesso rápido** (modo de teste).

| Nome     | Login    | Perfil       | Abas                                         |
|----------|----------|--------------|----------------------------------------------|
| Leandro  | leandro  | Diretor      | Faturamento, Gestão, Coordenação, Diretoria  |
| Thalita  | thalita  | Coordenadora | Faturamento, Gestão, Coordenação             |
| Larissa  | larissa  | Supervisora  | Faturamento, Gestão                          |
| Fabricio | fabricio | Faturista    | Faturamento                                  |
| Mister   | mister   | Faturista    | Faturamento                                  |

O banco começa com ~200 lotes fictícios dos últimos 5 meses (marcados como "demo") para os
relatórios terem o que mostrar. Em **Gestão → Lotes da equipe → Apagar dados de demonstração**
eles somem e ficam só os lotes de verdade.

Para começar do zero, apague a pasta `data/` com o servidor desligado.

## As abas

- **Faturamento** — envia o PDF, confere os campos lidos e salva. Lista e edita os próprios lotes.
  Lote conferido pela gestão fica travado para o faturista; lote devolvido mostra o motivo e volta
  para a fila quando o faturista corrige.
- **Gestão** — lotes de toda a equipe (conferir, devolver com motivo, editar, excluir, ver o PDF),
  cadastro de usuários e de convênios.
- **Coordenação** — produção de cada faturista por dia, mês ou ano; relatório por convênio,
  competência, faturista ou período; filtros; exportar CSV (abre no Excel) e imprimir.
- **Diretoria** — mês atual comparado com o mesmo trecho do mês anterior, evolução de 12 meses,
  convênios no ano, equipe no mês e situação dos lotes.

## Leitura do PDF

Feita em [src/extrator.js](src/extrator.js), no modelo do relatório de protocolo (`FatAct_R1`):

| Campo              | De onde vem                                   |
|--------------------|-----------------------------------------------|
| Nº do lote         | `PROTOCOLO: 361843-BRADESCO` → `361843`        |
| Convênio           | `Bradesco Saúde (635902)` → nome e código      |
| Guias              | `Total do protocolo 10/10` → regra abaixo      |
| Valor total        | maior valor da linha `Total do protocolo`      |
| Competência        | coluna `Refer` mais frequente (`11/26`)        |
| Período e tipo     | `Período de … até …` e `Tipo protocolo:`       |

**Regra das guias:** quando vem `X/Y`, conta o **maior** número. Para contar o menor, rode com
`FATURALE_REGRA_GUIAS=menor`. O sistema também conta as linhas de guia listadas no PDF e avisa
se não bater com o total.

Todo campo lido pode ser corrigido antes de salvar. O mesmo lote não entra duas vezes para o
mesmo convênio.

## Configuração

| Variável               | Padrão  | Para quê                                        |
|------------------------|---------|-------------------------------------------------|
| `PORT`                 | 3000    | Porta do servidor                               |
| `FATURALE_REGRA_GUIAS` | maior   | `maior` ou `menor` no `X/Y` das guias           |
| `FATURALE_MODO_TESTE`  | ligado  | `0` esconde o acesso rápido sem senha do login  |

Antes de usar com dados reais: `FATURALE_MODO_TESTE=0` e trocar as senhas de teste.

## Estrutura

```
server.js          rotas da API e permissões por perfil
src/db.js          banco SQLite, tabelas e dados de teste
src/extrator.js    leitura do PDF
src/config.js      regra das guias, porta, modo de teste
public/            telas (HTML, CSS e JS sem framework)
data/              banco e PDFs enviados (fora do Git)
```
