import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, unlinkSync, renameSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { db, hashSenha, conferirSenha } from './src/db.js';
import { extrairLote } from './src/extrator.js';
import { PORTA, MODO_TESTE, REGRA_GUIAS } from './src/config.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---------- Perfis e abas ----------
// Quem vê cada aba. A Diretoria vê tudo.
const ABAS = {
  faturista: ['faturamento'],
  supervisora: ['faturamento', 'gestao'],
  coordenadora: ['faturamento', 'gestao', 'coordenacao'],
  diretor: ['faturamento', 'gestao', 'coordenacao', 'diretoria'],
};
const pode = (u, aba) => ABAS[u.perfil]?.includes(aba);
const vêTodos = (u) => u.perfil !== 'faturista';

// ---------- Sessão ----------
function lerCookie(req, nome) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function abrirSessao(res, usuarioId) {
  const token = randomBytes(24).toString('hex');
  db.prepare("INSERT INTO sessoes (token, usuario_id, expira) VALUES (?,?,datetime('now','+12 hours'))").run(token, usuarioId);
  res.setHeader('Set-Cookie', `faturale=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
}
function autenticado(req, res, next) {
  const token = lerCookie(req, 'faturale');
  const u = token && db.prepare(`SELECT u.id, u.nome, u.login, u.perfil FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira > datetime('now') AND u.ativo = 1`).get(token);
  if (!u) return res.status(401).json({ erro: 'Faça login.' });
  req.usuario = u;
  next();
}
const exige = (aba) => (req, res, next) => (pode(req.usuario, aba) ? next() : res.status(403).json({ erro: 'Sem acesso.' }));
const perfilPublico = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, abas: ABAS[u.perfil] });

app.post('/api/login', (req, res) => {
  const { login, senha } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(String(login || '').trim().toLowerCase());
  if (!u || !conferirSenha(String(senha || ''), u.senha_hash)) return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  abrirSessao(res, u.id);
  res.json(perfilPublico(u));
});

// Acesso rápido só no modo de teste: entra como um dos usuários de teste sem digitar senha.
app.get('/api/teste/usuarios', (req, res) => {
  if (!MODO_TESTE) return res.json([]);
  res.json(db.prepare('SELECT nome, login, perfil FROM usuarios WHERE ativo = 1 ORDER BY id').all());
});
app.post('/api/teste/entrar', (req, res) => {
  if (!MODO_TESTE) return res.status(404).end();
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(String(req.body?.login || ''));
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  abrirSessao(res, u.id);
  res.json(perfilPublico(u));
});

app.post('/api/logout', (req, res) => {
  const token = lerCookie(req, 'faturale');
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'faturale=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', autenticado);
app.get('/api/eu', (req, res) => res.json({ ...perfilPublico(req.usuario), regraGuias: REGRA_GUIAS }));

// ---------- Convênios ----------
app.get('/api/convenios', (req, res) => res.json(db.prepare('SELECT * FROM convenios ORDER BY nome').all()));
app.post('/api/convenios', exige('gestao'), (req, res) => {
  const { nome, codigo } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome.' });
  try {
    const r = db.prepare('INSERT INTO convenios (nome, codigo) VALUES (?,?)').run(nome.trim(), codigo?.trim() || null);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { res.status(409).json({ erro: 'Já existe convênio com esse código.' }); }
});
app.put('/api/convenios/:id', exige('gestao'), (req, res) => {
  const { nome, codigo, ativo } = req.body || {};
  try {
    db.prepare('UPDATE convenios SET nome = ?, codigo = ?, ativo = ? WHERE id = ?').run(nome.trim(), codigo?.trim() || null, ativo ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch { res.status(409).json({ erro: 'Já existe convênio com esse código.' }); }
});
app.delete('/api/convenios/:id', exige('gestao'), (req, res) => {
  const usado = db.prepare('SELECT COUNT(*) n FROM lotes WHERE convenio_id = ?').get(req.params.id).n;
  if (usado) return res.status(409).json({ erro: `Convênio tem ${usado} lote(s). Desative em vez de excluir.` });
  db.prepare('DELETE FROM convenios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Usuários ----------
// Supervisora e coordenadora cadastram faturistas; só a diretoria cria os demais perfis.
const perfisQuePodeCriar = (u) => (u.perfil === 'diretor' ? ['faturista', 'supervisora', 'coordenadora', 'diretor'] : ['faturista']);
app.get('/api/faturistas', (req, res) => {
  res.json(db.prepare("SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY perfil <> 'faturista', nome").all());
});
app.get('/api/usuarios', exige('gestao'), (req, res) => {
  res.json(db.prepare('SELECT id, nome, login, perfil, ativo, criado_em FROM usuarios ORDER BY nome').all());
});
app.post('/api/usuarios', exige('gestao'), (req, res) => {
  const { nome, login, senha, perfil } = req.body || {};
  if (!perfisQuePodeCriar(req.usuario).includes(perfil)) return res.status(403).json({ erro: 'Você não pode criar esse perfil.' });
  if (!nome?.trim() || !login?.trim() || !senha || senha.length < 6) return res.status(400).json({ erro: 'Preencha nome, login e senha (mínimo 6).' });
  try {
    const r = db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?,?,?,?)').run(nome.trim(), login.trim().toLowerCase(), hashSenha(senha), perfil);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { res.status(409).json({ erro: 'Login já existe.' }); }
});
app.put('/api/usuarios/:id', exige('gestao'), (req, res) => {
  const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!alvo) return res.status(404).json({ erro: 'Não encontrado.' });
  const { nome, perfil, ativo, senha } = req.body || {};
  const permitidos = perfisQuePodeCriar(req.usuario);
  if (!permitidos.includes(alvo.perfil) || !permitidos.includes(perfil)) return res.status(403).json({ erro: 'Você não pode alterar esse usuário.' });
  if (alvo.id === req.usuario.id && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a si mesmo.' });
  db.prepare('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?').run(nome.trim(), perfil, ativo ? 1 : 0, alvo.id);
  if (senha) {
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha com mínimo de 6 caracteres.' });
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), alvo.id);
  }
  if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(alvo.id);
  res.json({ ok: true });
});

// ---------- Lotes ----------
const pendentes = new Map(); // PDFs enviados e ainda não salvos: id -> { caminho, criado }

app.post('/api/lotes/extrair', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um PDF.' });
  if (!req.file.buffer.subarray(0, 5).toString().startsWith('%PDF')) return res.status(400).json({ erro: 'O arquivo não é um PDF.' });
  try {
    const dados = await extrairLote(req.file.buffer);
    const id = randomBytes(12).toString('hex');
    const caminho = path.join('data', 'pdfs', `pendente-${id}.pdf`);
    writeFileSync(caminho, req.file.buffer);
    pendentes.set(id, { caminho, criado: Date.now() });
    const conv = dados.convenioCodigo
      ? db.prepare('SELECT id FROM convenios WHERE codigo = ?').get(dados.convenioCodigo)
      : db.prepare('SELECT id FROM convenios WHERE lower(nome) = lower(?)').get(dados.convenioNome);
    const repetido = conv && db.prepare('SELECT id, faturista_id FROM lotes WHERE numero_lote = ? AND convenio_id = ?').get(dados.numeroLote, conv.id);
    if (repetido) dados.avisos.push('Este lote já foi lançado para este convênio.');
    res.json({ ...dados, arquivoId: id, convenioId: conv?.id || null, nomeArquivo: req.file.originalname });
  } catch (e) {
    console.error(e);
    res.status(422).json({ erro: 'Não consegui ler esse PDF. Preencha os dados à mão.' });
  }
});

function filtroLotes(req) {
  const q = req.query;
  const onde = [];
  const args = [];
  if (!vêTodos(req.usuario)) { onde.push('l.faturista_id = ?'); args.push(req.usuario.id); }
  else if (q.faturista) { onde.push('l.faturista_id = ?'); args.push(q.faturista); }
  if (q.convenio) { onde.push('l.convenio_id = ?'); args.push(q.convenio); }
  if (q.competencia) { onde.push('l.competencia = ?'); args.push(q.competencia); }
  if (q.inicio) { onde.push('l.data_lancamento >= ?'); args.push(q.inicio); }
  if (q.fim) { onde.push('l.data_lancamento <= ?'); args.push(q.fim); }
  if (q.status) { onde.push('l.status = ?'); args.push(q.status); }
  if (q.busca) { onde.push('l.numero_lote LIKE ?'); args.push(`%${q.busca}%`); }
  return { where: onde.length ? `WHERE ${onde.join(' AND ')}` : '', args };
}
const SELECT_LOTE = `SELECT l.*, c.nome convenio, u.nome faturista FROM lotes l
  JOIN convenios c ON c.id = l.convenio_id JOIN usuarios u ON u.id = l.faturista_id`;

app.get('/api/lotes', (req, res) => {
  const { where, args } = filtroLotes(req);
  res.json(db.prepare(`${SELECT_LOTE} ${where} ORDER BY l.data_lancamento DESC, l.id DESC LIMIT 1000`).all(...args));
});

function validarLote(b) {
  if (!String(b.numeroLote || '').trim()) return 'Informe o número do lote.';
  if (!(Number(b.qtdGuias) > 0)) return 'Quantidade de guias inválida.';
  if (!(Number(b.valorTotal) >= 0)) return 'Valor inválido.';
  if (!/^\d{4}-\d{2}$/.test(b.competencia || '')) return 'Competência inválida (use mês/ano).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dataLancamento || '')) return 'Data de lançamento inválida.';
  return null;
}
// Acha o convênio pelo id, ou cria a partir do que veio do PDF.
function resolverConvenio(b) {
  if (b.convenioId) return Number(b.convenioId);
  if (!b.convenioNome?.trim()) return null;
  const achado = b.convenioCodigo && db.prepare('SELECT id FROM convenios WHERE codigo = ?').get(b.convenioCodigo);
  if (achado) return achado.id;
  return Number(db.prepare('INSERT INTO convenios (nome, codigo) VALUES (?,?)').run(b.convenioNome.trim(), b.convenioCodigo || null).lastInsertRowid);
}

app.post('/api/lotes', (req, res) => {
  const b = req.body || {};
  const erro = validarLote(b);
  if (erro) return res.status(400).json({ erro });
  const convenioId = resolverConvenio(b);
  if (!convenioId) return res.status(400).json({ erro: 'Informe o convênio.' });
  const faturistaId = vêTodos(req.usuario) && b.faturistaId ? Number(b.faturistaId) : req.usuario.id;
  if (db.prepare('SELECT 1 FROM lotes WHERE numero_lote = ? AND convenio_id = ?').get(String(b.numeroLote).trim(), convenioId)) {
    return res.status(409).json({ erro: 'Este lote já foi lançado para este convênio.' });
  }
  let arquivo = null;
  const p = b.arquivoId && pendentes.get(b.arquivoId);
  const r = db.prepare(`INSERT INTO lotes (numero_lote, convenio_id, faturista_id, qtd_guias, guias_texto, valor_total, competencia,
    periodo_inicio, periodo_fim, tipo, prestador, observacao, data_lancamento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    String(b.numeroLote).trim(), convenioId, faturistaId, Number(b.qtdGuias), b.guiasTexto || null, Number(b.valorTotal),
    b.competencia, b.periodoInicio || null, b.periodoFim || null, b.tipo || null, b.prestador || null, b.observacao || null, b.dataLancamento);
  const id = Number(r.lastInsertRowid);
  if (p && existsSync(p.caminho)) {
    arquivo = path.join('data', 'pdfs', `lote-${id}.pdf`);
    renameSync(p.caminho, arquivo);
    pendentes.delete(b.arquivoId);
    db.prepare('UPDATE lotes SET arquivo = ? WHERE id = ?').run(arquivo, id);
  }
  res.json({ id });
});

function loteDoUsuario(req, res) {
  const l = db.prepare('SELECT * FROM lotes WHERE id = ?').get(req.params.id);
  if (!l) { res.status(404).json({ erro: 'Lote não encontrado.' }); return null; }
  if (!vêTodos(req.usuario) && l.faturista_id !== req.usuario.id) { res.status(403).json({ erro: 'Sem acesso.' }); return null; }
  return l;
}

app.put('/api/lotes/:id', (req, res) => {
  const l = loteDoUsuario(req, res);
  if (!l) return;
  if (!vêTodos(req.usuario) && l.status === 'conferido') return res.status(403).json({ erro: 'Lote já conferido. Peça à gestão para alterar.' });
  const b = req.body || {};
  const erro = validarLote(b);
  if (erro) return res.status(400).json({ erro });
  const convenioId = resolverConvenio(b);
  const faturistaId = vêTodos(req.usuario) && b.faturistaId ? Number(b.faturistaId) : l.faturista_id;
  try {
    db.prepare(`UPDATE lotes SET numero_lote=?, convenio_id=?, faturista_id=?, qtd_guias=?, valor_total=?, competencia=?,
      periodo_inicio=?, periodo_fim=?, tipo=?, observacao=?, data_lancamento=?, atualizado_em=datetime('now','localtime') WHERE id=?`).run(
      String(b.numeroLote).trim(), convenioId, faturistaId, Number(b.qtdGuias), Number(b.valorTotal), b.competencia,
      b.periodoInicio || null, b.periodoFim || null, b.tipo || null, b.observacao || null, b.dataLancamento, l.id);
    // Faturista corrigiu um lote devolvido: volta para a fila de conferência.
    if (!vêTodos(req.usuario) && l.status === 'devolvido') db.prepare("UPDATE lotes SET status = 'lancado' WHERE id = ?").run(l.id);
    res.json({ ok: true });
  } catch { res.status(409).json({ erro: 'Já existe esse lote para esse convênio.' }); }
});

app.patch('/api/lotes/:id/status', exige('gestao'), (req, res) => {
  const { status, observacao } = req.body || {};
  if (!['lancado', 'conferido', 'devolvido'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  db.prepare("UPDATE lotes SET status = ?, observacao = COALESCE(?, observacao), atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(status, observacao ?? null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/lotes/:id', (req, res) => {
  const l = loteDoUsuario(req, res);
  if (!l) return;
  if (!vêTodos(req.usuario) && l.status === 'conferido') return res.status(403).json({ erro: 'Lote já conferido. Peça à gestão para excluir.' });
  db.prepare('DELETE FROM lotes WHERE id = ?').run(l.id);
  if (l.arquivo && existsSync(l.arquivo)) unlinkSync(l.arquivo);
  res.json({ ok: true });
});

app.get('/api/lotes/:id/pdf', (req, res) => {
  const l = loteDoUsuario(req, res);
  if (!l) return;
  if (!l.arquivo || !existsSync(l.arquivo)) return res.status(404).json({ erro: 'Lote sem PDF.' });
  res.type('pdf').sendFile(path.resolve(l.arquivo));
});

app.delete('/api/demonstracao', exige('gestao'), (req, res) => {
  const r = db.prepare('DELETE FROM lotes WHERE demo = 1').run();
  res.json({ apagados: Number(r.changes) });
});

// ---------- Relatórios ----------
const AGRUPAR = {
  dia: 'l.data_lancamento',
  mes: "substr(l.data_lancamento, 1, 7)",
  ano: "substr(l.data_lancamento, 1, 4)",
  competencia: 'l.competencia',
  convenio: 'c.nome',
  faturista: 'u.nome',
};
function relatorio(req, chave) {
  const { where, args } = filtroLotes(req);
  const col = AGRUPAR[chave] || AGRUPAR.mes;
  return db.prepare(`SELECT ${col} grupo, COUNT(*) lotes, SUM(l.qtd_guias) guias, ROUND(SUM(l.valor_total), 2) valor
    FROM lotes l JOIN convenios c ON c.id = l.convenio_id JOIN usuarios u ON u.id = l.faturista_id
    ${where} GROUP BY grupo ORDER BY ${['convenio', 'faturista'].includes(chave) ? 'valor DESC' : 'grupo'}`).all(...args);
}
function totais(req) {
  const { where, args } = filtroLotes(req);
  return db.prepare(`SELECT COUNT(*) lotes, COALESCE(SUM(qtd_guias),0) guias, ROUND(COALESCE(SUM(valor_total),0),2) valor FROM lotes l ${where}`).get(...args);
}

// Faturista vê só a própria produção; os demais veem a equipe.
app.get('/api/relatorios', (req, res) => {
  const por = String(req.query.por || 'mes');
  res.json({ por, totais: totais(req), linhas: relatorio(req, por) });
});

// Produção dos faturistas lado a lado, por dia/mês/ano.
app.get('/api/relatorios/producao', exige('coordenacao'), (req, res) => {
  const { where, args } = filtroLotes(req);
  const col = AGRUPAR[req.query.por] || AGRUPAR.dia;
  res.json(db.prepare(`SELECT ${col} grupo, u.nome faturista, COUNT(*) lotes, SUM(l.qtd_guias) guias, ROUND(SUM(l.valor_total),2) valor
    FROM lotes l JOIN convenios c ON c.id = l.convenio_id JOIN usuarios u ON u.id = l.faturista_id
    ${where} GROUP BY grupo, u.id ORDER BY grupo DESC, valor DESC`).all(...args));
});

app.get('/api/relatorios/csv', (req, res) => {
  const { where, args } = filtroLotes(req);
  const linhas = db.prepare(`${SELECT_LOTE} ${where} ORDER BY l.data_lancamento, l.id`).all(...args);
  const cab = ['Lote', 'Convênio', 'Faturista', 'Competência', 'Data lançamento', 'Guias', 'Valor', 'Status', 'Tipo'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const corpo = linhas.map((l) => [l.numero_lote, l.convenio, l.faturista, l.competencia, l.data_lancamento, l.qtd_guias,
    String(l.valor_total.toFixed(2)).replace('.', ','), l.status, l.tipo].map(esc).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="faturale-relatorio.csv"');
  res.send('﻿' + [cab.map(esc).join(';'), ...corpo].join('\r\n'));
});

// Painel da diretoria: mês atual x anterior, evolução, convênios e equipe.
app.get('/api/diretoria/painel', exige('diretoria'), (req, res) => {
  const agora = new Date();
  const mes = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const atual = mes(agora);
  const anterior = mes(new Date(agora.getFullYear(), agora.getMonth() - 1, 1));
  // ateDia: corta o mês até esse dia, para comparar o mês corrente com o mesmo trecho do anterior.
  const doMes = (m, ateDia = 31) => db.prepare(`SELECT COUNT(*) lotes, COALESCE(SUM(qtd_guias),0) guias, ROUND(COALESCE(SUM(valor_total),0),2) valor,
    SUM(status='conferido') conferidos, SUM(status='devolvido') devolvidos FROM lotes
    WHERE substr(data_lancamento,1,7) = ? AND CAST(substr(data_lancamento,9,2) AS INTEGER) <= ?`).get(m, ateDia);
  const base = `FROM lotes l JOIN convenios c ON c.id = l.convenio_id JOIN usuarios u ON u.id = l.faturista_id`;
  res.json({
    atual, anterior,
    mesAtual: doMes(atual),
    mesAnterior: doMes(anterior),
    mesAnteriorAteHoje: doMes(anterior, agora.getDate()),
    diaHoje: agora.getDate(),
    evolucao: db.prepare(`SELECT substr(data_lancamento,1,7) grupo, COUNT(*) lotes, SUM(qtd_guias) guias, ROUND(SUM(valor_total),2) valor
      FROM lotes GROUP BY grupo ORDER BY grupo DESC LIMIT 12`).all().reverse(),
    convenios: db.prepare(`SELECT c.nome grupo, COUNT(*) lotes, SUM(l.qtd_guias) guias, ROUND(SUM(l.valor_total),2) valor ${base}
      WHERE substr(l.data_lancamento,1,4) = ? GROUP BY c.id ORDER BY valor DESC`).all(String(agora.getFullYear())),
    equipe: db.prepare(`SELECT u.nome grupo, COUNT(*) lotes, SUM(l.qtd_guias) guias, ROUND(SUM(l.valor_total),2) valor ${base}
      WHERE substr(l.data_lancamento,1,7) = ? GROUP BY u.id ORDER BY valor DESC`).all(atual),
    status: db.prepare('SELECT status grupo, COUNT(*) lotes, ROUND(SUM(valor_total),2) valor FROM lotes GROUP BY status').all(),
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ erro: err.code === 'LIMIT_FILE_SIZE' ? 'PDF muito grande (máx. 20 MB).' : 'Erro no servidor.' });
});

// Apaga PDFs enviados e não salvos há mais de 2 horas (também os que sobraram de antes de reiniciar).
function limparPendentes() {
  for (const nome of readdirSync(path.join('data', 'pdfs'))) {
    if (!nome.startsWith('pendente-')) continue;
    const caminho = path.join('data', 'pdfs', nome);
    if (Date.now() - statSync(caminho).mtimeMs > 2 * 3600e3) {
      unlinkSync(caminho);
      pendentes.delete(nome.slice(9, -4));
    }
  }
}
limparPendentes();
setInterval(limparPendentes, 600e3).unref();

app.listen(PORTA, () => console.log(`Faturale rodando em http://localhost:${PORTA}`));
