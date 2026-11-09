// Banco SQLite (embutido no Node, sem instalar nada) e dados iniciais de teste.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

mkdirSync('data/pdfs', { recursive: true });
export const db = new DatabaseSync('data/faturale.db');
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('faturista','supervisora','coordenadora','diretor')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS convenios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  codigo TEXT UNIQUE,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY,
  numero_lote TEXT NOT NULL,
  convenio_id INTEGER NOT NULL REFERENCES convenios(id),
  faturista_id INTEGER NOT NULL REFERENCES usuarios(id),
  qtd_guias INTEGER NOT NULL,
  guias_texto TEXT,
  valor_total REAL NOT NULL,
  competencia TEXT NOT NULL,           -- AAAA-MM
  periodo_inicio TEXT,
  periodo_fim TEXT,
  tipo TEXT,
  prestador TEXT,
  status TEXT NOT NULL DEFAULT 'lancado' CHECK (status IN ('lancado','conferido','devolvido')),
  observacao TEXT,
  arquivo TEXT,
  data_lancamento TEXT NOT NULL,       -- AAAA-MM-DD, dia da produção do faturista
  demo INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT,
  UNIQUE (numero_lote, convenio_id)
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira TEXT NOT NULL
);
`);

export function hashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(senha, sal, 32).toString('hex')}`;
}
export function conferirSenha(senha, hash) {
  const [sal, h] = String(hash).split(':');
  if (!sal || !h) return false;
  return timingSafeEqual(Buffer.from(h, 'hex'), scryptSync(senha, sal, 32));
}

// Usuários de teste. A senha de todos está em README.md.
const SENHA_TESTE = 'faturale';
const EQUIPE = [
  ['Leandro', 'leandro', 'diretor'],
  ['Thalita', 'thalita', 'coordenadora'],
  ['Larissa', 'larissa', 'supervisora'],
  ['Fabricio', 'fabricio', 'faturista'],
  ['Mister', 'mister', 'faturista'],
];

const vazio = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n === 0;
if (vazio) {
  const ins = db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?,?,?,?)');
  for (const [nome, login, perfil] of EQUIPE) ins.run(nome, login, hashSenha(SENHA_TESTE), perfil);

  const conv = db.prepare('INSERT INTO convenios (nome, codigo) VALUES (?,?)');
  for (const [n, c] of [
    ['Bradesco Saúde', '635902'], ['Amil', '326305'], ['SulAmérica', '006246'],
    ['Unimed', '343889'], ['Cassi', '346659'], ['GEAP', '323080'],
  ]) conv.run(n, c);

  semearDemonstracao();
}

// Lotes fictícios dos últimos meses, só para os relatórios terem o que mostrar.
// Ficam marcados como demonstração e a Gestão pode apagar todos de uma vez.
function semearDemonstracao() {
  const fat = db.prepare("SELECT id FROM usuarios WHERE perfil='faturista'").all().map((r) => r.id);
  const convs = db.prepare('SELECT id FROM convenios').all().map((r) => r.id);
  const ins = db.prepare(`INSERT INTO lotes (numero_lote, convenio_id, faturista_id, qtd_guias, guias_texto, valor_total,
    competencia, periodo_inicio, periodo_fim, tipo, status, data_lancamento, demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  let semente = 7;
  const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const hoje = new Date();
  let lote = 300000;
  for (let d = 150; d >= 1; d--) {
    const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - d);
    if (dia.getDay() === 0 || dia.getDay() === 6) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const guias = 3 + Math.floor(rnd() * 40);
      const valor = Math.round(guias * (150 + rnd() * 250) * 100) / 100;
      const iso = dia.toISOString().slice(0, 10);
      const comp = new Date(dia.getFullYear(), dia.getMonth() + 1, 1).toISOString().slice(0, 7);
      ins.run(String(lote++), convs[Math.floor(rnd() * convs.length)], fat[Math.floor(rnd() * fat.length)],
        guias, `${guias}/${guias}`, valor, comp, iso, iso, rnd() < 0.6 ? 'Exames' : 'Consultas',
        d > 20 ? 'conferido' : 'lancado', iso);
    }
  }
}
