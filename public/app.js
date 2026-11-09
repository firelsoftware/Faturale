// Faturale — interface (sem framework: cada aba monta o próprio HTML).

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaCurta = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : moeda(v));
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const compBR = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '—');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (c) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => isoLocal(new Date());
const inicioMes = () => hoje().slice(0, 8) + '01';
const inicioAno = () => hoje().slice(0, 5) + '01-01';
// Aceita "2.327,79", "2327,79" ou "2327.79"
const lerValor = (t) => { t = String(t).trim(); return t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t); };
const valorBR = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERFIS = { faturista: 'Faturista', supervisora: 'Supervisora', coordenadora: 'Coordenadora', diretor: 'Diretor' };
const STATUS = { lancado: 'Lançado', conferido: 'Conferido', devolvido: 'Devolvido' };

async function api(url, opcoes = {}) {
  const o = { ...opcoes, headers: { ...(opcoes.headers || {}) } };
  if (o.corpo !== undefined) { o.body = JSON.stringify(o.corpo); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o);
  if (r.status === 401 && !url.includes('/login')) { mostrarLogin(); throw new Error('Sessão expirada.'); }
  const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(dados?.erro || 'Erro inesperado.');
  return dados;
}
const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();

function avisar(msg, erro = false) {
  const el = document.createElement('div');
  el.className = `aviso-flutuante${erro ? ' erro' : ''}`;
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}
const tentar = (fn) => async (...a) => { try { await fn(...a); } catch (e) { avisar(e.message, true); } };

function modal(html, aoMontar) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `<div class="modal">${html}</div>`;
  const fechar = () => fundo.remove();
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  $$('[data-fechar]', fundo).forEach((b) => b.addEventListener('click', fechar));
  document.body.append(fundo);
  aoMontar?.(fundo, fechar);
  return fechar;
}

const ICONES = {
  faturamento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  gestao: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  coordenacao: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  diretoria: '<rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
};
const icone = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[n]}</svg>`;
const NOMES_ABAS = { faturamento: 'Faturamento', gestao: 'Gestão', coordenacao: 'Coordenação', diretoria: 'Diretoria' };

// ---------- Estado ----------
const estado = { usuario: null, convenios: [], faturistas: [], aba: null };
const veTodos = () => estado.usuario?.perfil !== 'faturista';

async function carregarListas() {
  [estado.convenios, estado.faturistas] = await Promise.all([api('/api/convenios'), api('/api/faturistas')]);
}
const opcoesConvenio = (sel, todos = true) => (todos ? '<option value="">Todos</option>' : '') +
  estado.convenios.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativo)'}</option>`).join('');
const opcoesFaturista = (sel, todos = true) => (todos ? '<option value="">Todos</option>' : '') +
  estado.faturistas.map((f) => `<option value="${f.id}" ${String(sel) === String(f.id) ? 'selected' : ''}>${esc(f.nome)}</option>`).join('');

// ---------- Login ----------
function mostrarLogin() {
  $('#tela-app').classList.add('oculto');
  $('#tela-login').classList.remove('oculto');
  $('#login').focus();
  api('/api/teste/usuarios').then((lista) => {
    if (!lista.length) return;
    $('#acesso-teste').classList.remove('oculto');
    $('#acesso-teste .teste-botoes').innerHTML = lista.map((u) =>
      `<button data-login="${esc(u.login)}">${esc(u.nome)} <small>${PERFIS[u.perfil]}</small></button>`).join('');
  }).catch(() => {});
}
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    estado.usuario = await api('/api/login', { method: 'POST', corpo: { login: $('#login').value, senha: $('#senha').value } });
    $('#senha').value = '';
    entrar();
  } catch (err) { $('#erro-login').textContent = err.message; }
});
$('#acesso-teste').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-login]');
  if (!b) return;
  try { estado.usuario = await api('/api/teste/entrar', { method: 'POST', corpo: { login: b.dataset.login } }); entrar(); }
  catch (err) { $('#erro-login').textContent = err.message; }
});
$('#sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); estado.usuario = null; mostrarLogin(); });

async function entrar() {
  $('#tela-login').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');
  const u = estado.usuario;
  $('#nome-usuario').textContent = u.nome;
  $('#perfil-usuario').textContent = PERFIS[u.perfil];
  $('#abas').innerHTML = u.abas.map((a) => `<button class="aba" data-aba="${a}">${icone(a)}${NOMES_ABAS[a]}</button>`).join('');
  await carregarListas();
  const salva = location.hash.slice(1);
  // Abre na aba "mais alta" do perfil (faturista → Faturamento, diretor → Diretoria…)
  abrirAba(u.abas.includes(salva) ? salva : u.abas[u.abas.length - 1]);
}
$('#abas').addEventListener('click', (e) => { const b = e.target.closest('[data-aba]'); if (b) abrirAba(b.dataset.aba); });

function abrirAba(aba) {
  estado.aba = aba;
  $('#conteudo').onclick = null;
  history.replaceState(null, '', `#${aba}`);
  $$('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  const telas = { faturamento: telaFaturamento, gestao: telaGestao, coordenacao: telaCoordenacao, diretoria: telaDiretoria };
  tentar(telas[aba])();
}

// ---------- Formulário de lote (novo a partir do PDF, ou edição) ----------
function formLote(d) {
  const convExiste = d.convenioId && estado.convenios.some((c) => c.id === Number(d.convenioId));
  const opcaoNova = !convExiste && d.convenioNome
    ? `<option value="novo" selected>+ ${esc(d.convenioNome)}${d.convenioCodigo ? ` (${esc(d.convenioCodigo)})` : ''} — cadastrar</option>` : '';
  return `
    <div class="grade">
      <div class="campo"><label>Nº do lote / protocolo</label><input name="numeroLote" value="${esc(d.numeroLote)}" required></div>
      <div class="campo"><label>Convênio</label><select name="convenio">${opcaoNova}${!convExiste && !opcaoNova ? '<option value="">Selecione…</option>' : ''}${opcoesConvenio(d.convenioId, false)}</select></div>
      <div class="campo"><label>Quantidade de guias</label><input name="qtdGuias" type="number" min="1" value="${esc(d.qtdGuias || '')}" required>
        ${d.guiasTexto ? `<div class="guias-regra">No PDF: ${esc(d.guiasTexto)} → conta ${esc(d.qtdGuias)}</div>` : ''}</div>
      <div class="campo"><label>Valor total (R$)</label><input name="valorTotal" inputmode="decimal" value="${d.valorTotal != null ? valorBR(d.valorTotal) : ''}" required></div>
      <div class="campo"><label>Competência</label><input name="competencia" type="month" value="${esc(d.competencia)}" required></div>
      <div class="campo"><label>Data do lançamento</label><input name="dataLancamento" type="date" value="${esc(d.dataLancamento || hoje())}" required></div>
      <div class="campo"><label>Período (início)</label><input name="periodoInicio" type="date" value="${esc(d.periodoInicio)}"></div>
      <div class="campo"><label>Período (fim)</label><input name="periodoFim" type="date" value="${esc(d.periodoFim)}"></div>
      <div class="campo"><label>Tipo</label><input name="tipo" value="${esc(d.tipo)}" placeholder="Exames, Consultas…"></div>
      ${veTodos() ? `<div class="campo"><label>Faturista responsável</label><select name="faturistaId">${opcoesFaturista(d.faturistaId || estado.usuario.id, false)}</select></div>` : ''}
    </div>
    <div class="campo"><label>Observação</label><textarea name="observacao" rows="2">${esc(d.observacao)}</textarea></div>`;
}
function lerFormLote(form, extra = {}) {
  const f = Object.fromEntries(new FormData(form));
  const corpo = { ...extra, ...f, valorTotal: lerValor(f.valorTotal), qtdGuias: Number(f.qtdGuias) };
  if (f.convenio === 'novo') { corpo.convenioId = null; }
  else { corpo.convenioId = f.convenio || null; delete corpo.convenioNome; delete corpo.convenioCodigo; }
  if (!corpo.convenioId && !corpo.convenioNome) throw new Error('Selecione o convênio.');
  if (Number.isNaN(corpo.valorTotal)) throw new Error('Valor inválido.');
  return corpo;
}

function editarLote(l, depois) {
  const dados = {
    numeroLote: l.numero_lote, convenioId: l.convenio_id, qtdGuias: l.qtd_guias, guiasTexto: l.guias_texto, valorTotal: l.valor_total,
    competencia: l.competencia, dataLancamento: l.data_lancamento, periodoInicio: l.periodo_inicio, periodoFim: l.periodo_fim,
    tipo: l.tipo, faturistaId: l.faturista_id, observacao: l.observacao,
  };
  modal(`<h2>Editar lote ${esc(l.numero_lote)}</h2><form>${formLote(dados)}
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`,
  (el, fechar) => {
    $('form', el).addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      await api(`/api/lotes/${l.id}`, { method: 'PUT', corpo: lerFormLote(e.target) });
      fechar(); avisar('Lote atualizado.'); depois();
    }));
  });
}
async function excluirLote(l, depois) {
  if (!confirm(`Excluir o lote ${l.numero_lote} (${l.convenio})? Isso não pode ser desfeito.`)) return;
  await api(`/api/lotes/${l.id}`, { method: 'DELETE' });
  avisar('Lote excluído.'); depois();
}

function tabelaLotes(lotes, { gestao = false } = {}) {
  if (!lotes.length) return '<div class="vazio">Nenhum lote encontrado.</div>';
  const tG = lotes.reduce((s, l) => s + l.qtd_guias, 0);
  const tV = lotes.reduce((s, l) => s + l.valor_total, 0);
  return `<div class="tabela-caixa"><table>
    <thead><tr><th>Lote</th><th>Convênio</th>${gestao ? '<th>Faturista</th>' : ''}<th>Competência</th><th>Lançado em</th>
      <th class="num">Guias</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead>
    <tbody>${lotes.map((l) => `<tr data-id="${l.id}">
      <td><b>${esc(l.numero_lote)}</b>${l.demo ? '<span class="selo demo">demo</span>' : ''}</td>
      <td>${esc(l.convenio)}</td>${gestao ? `<td>${esc(l.faturista)}</td>` : ''}
      <td>${compBR(l.competencia)}</td><td>${dataBR(l.data_lancamento)}</td>
      <td class="num">${num(l.qtd_guias)}</td><td class="num">${moeda(l.valor_total)}</td>
      <td><span class="selo ${l.status}" title="${esc(l.observacao)}">${STATUS[l.status]}</span>
        ${l.status === 'devolvido' && l.observacao ? `<br><small style="color:var(--vermelho)">${esc(l.observacao)}</small>` : ''}</td>
      <td><div class="acoes">
        ${l.arquivo ? `<a class="btn btn-claro btn-mini" href="/api/lotes/${l.id}/pdf" target="_blank">PDF</a>` : ''}
        ${gestao && l.status !== 'conferido' ? '<button class="btn btn-claro btn-mini" data-acao="conferir">Conferir</button>' : ''}
        ${gestao && l.status !== 'devolvido' ? '<button class="btn btn-claro btn-mini" data-acao="devolver">Devolver</button>' : ''}
        ${gestao || l.status !== 'conferido' ? `<button class="btn btn-claro btn-mini" data-acao="editar">Editar</button>
          <button class="btn btn-perigo btn-mini" data-acao="excluir">Excluir</button>` : ''}
      </div></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${gestao ? 5 : 4}">${num(lotes.length)} lote(s)</td><td class="num">${num(tG)}</td><td class="num">${moeda(tV)}</td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}
function ligarAcoesLotes(caixa, lotes, recarregar) {
  caixa.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const l = lotes().find((x) => x.id === Number(b.closest('tr').dataset.id));
    const acao = b.dataset.acao;
    if (acao === 'editar') editarLote(l, recarregar);
    if (acao === 'excluir') await excluirLote(l, recarregar);
    if (acao === 'conferir') { await api(`/api/lotes/${l.id}/status`, { method: 'PATCH', corpo: { status: 'conferido' } }); avisar('Lote conferido.'); recarregar(); }
    if (acao === 'devolver') {
      const motivo = prompt('Motivo da devolução (aparece para o faturista):', l.observacao || '');
      if (motivo === null) return;
      await api(`/api/lotes/${l.id}/status`, { method: 'PATCH', corpo: { status: 'devolvido', observacao: motivo } });
      avisar('Lote devolvido.'); recarregar();
    }
  }));
}

// ---------- Aba: Faturamento ----------
async function telaFaturamento() {
  const eu = estado.usuario;
  const meu = veTodos() ? { faturista: eu.id } : {};
  const [dia, mes, ano] = await Promise.all([
    api(`/api/relatorios?${qs({ ...meu, inicio: hoje(), fim: hoje() })}`),
    api(`/api/relatorios?${qs({ ...meu, inicio: inicioMes(), fim: hoje() })}`),
    api(`/api/relatorios?${qs({ ...meu, inicio: inicioAno(), fim: hoje() })}`),
  ]);
  const kpi = (t, r) => `<div class="kpi"><span>${t}</span><b>${moeda(r.totais.valor)}</b><small>${num(r.totais.guias)} guias · ${num(r.totais.lotes)} lotes</small></div>`;
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Faturamento</h1><p>Olá, ${esc(eu.nome)}. Envie o PDF do lote e confira os dados antes de salvar.</p></div></div>
    <div class="kpis">${kpi('Minha produção hoje', dia)}${kpi('Neste mês', mes)}${kpi('Neste ano', ano)}</div>
    <div class="cartao">
      <h2>Novo lote</h2>
      <label class="solta" id="solta">
        ${icone('upload')}
        <b>Arraste o PDF do lote aqui</b>
        <span>ou clique para escolher · o sistema lê lote, convênio, guias e valor</span>
        <input type="file" accept="application/pdf,.pdf" hidden id="arquivo">
      </label>
      <div id="revisao"></div>
    </div>
    <div class="cartao">
      <h2>Meus lotes</h2>
      <div class="filtros">
        <div class="campo"><label>Competência</label><input type="month" id="f-comp"></div>
        <div class="campo"><label>Convênio</label><select id="f-conv">${opcoesConvenio('')}</select></div>
        <div class="campo"><label>Status</label><select id="f-status"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Buscar lote</label><input id="f-busca" placeholder="Nº do lote"></div>
      </div>
      <div id="lista"></div>
    </div>`;

  let lotes = [];
  const carregar = tentar(async () => {
    lotes = await api(`/api/lotes?${qs({ ...meu, competencia: $('#f-comp').value, convenio: $('#f-conv').value, status: $('#f-status').value, busca: $('#f-busca').value })}`);
    $('#lista').innerHTML = tabelaLotes(lotes);
  });
  ['#f-comp', '#f-conv', '#f-status'].forEach((s) => $(s).addEventListener('change', carregar));
  $('#f-busca').addEventListener('input', carregar);
  ligarAcoesLotes($('#lista'), () => lotes, () => telaFaturamento());
  carregar();

  const solta = $('#solta');
  const enviar = tentar(async (arquivo) => {
    if (!arquivo) return;
    $('#revisao').innerHTML = '<div class="vazio">Lendo o PDF…</div>';
    const fd = new FormData();
    fd.append('pdf', arquivo);
    let d;
    try { d = await api('/api/lotes/extrair', { method: 'POST', body: fd }); }
    catch (e) { $('#revisao').innerHTML = ''; throw e; }
    mostrarRevisao(d);
  });
  solta.addEventListener('dragover', (e) => { e.preventDefault(); solta.classList.add('arrastando'); });
  solta.addEventListener('dragleave', () => solta.classList.remove('arrastando'));
  solta.addEventListener('drop', (e) => { e.preventDefault(); solta.classList.remove('arrastando'); enviar(e.dataTransfer.files[0]); });
  $('#arquivo').addEventListener('change', (e) => { enviar(e.target.files[0]); e.target.value = ''; });

  function mostrarRevisao(d) {
    const avisos = d.avisos.length
      ? `<div class="avisos">${d.avisos.map(esc).join('<br>')}</div>`
      : `<div class="avisos ok">Leitura completa de <b>${esc(d.nomeArquivo)}</b>${d.prestador ? ` · ${esc(d.prestador)}` : ''}. Confira e salve.</div>`;
    $('#revisao').innerHTML = `<form style="margin-top:18px">${avisos}${formLote(d)}
      <div class="acoes"><button type="button" class="btn btn-claro" id="cancelar">Cancelar</button><button class="btn btn-primario">Salvar lote</button></div></form>`;
    $('#cancelar').addEventListener('click', () => { $('#revisao').innerHTML = ''; });
    $('#revisao form').addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const corpo = lerFormLote(e.target, { arquivoId: d.arquivoId, guiasTexto: d.guiasTexto, prestador: d.prestador, convenioNome: d.convenioNome, convenioCodigo: d.convenioCodigo });
      await api('/api/lotes', { method: 'POST', corpo });
      avisar(`Lote ${corpo.numeroLote} salvo.`);
      await carregarListas();
      telaFaturamento();
    }));
  }
}

// ---------- Aba: Gestão ----------
let subGestao = 'lotes';
async function telaGestao() {
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Gestão</h1><p>Conferência dos lotes da equipe e cadastros.</p></div></div>
    <div class="subabas">${[['lotes', 'Lotes da equipe'], ['usuarios', 'Usuários'], ['convenios', 'Convênios']]
      .map(([k, v]) => `<button data-sub="${k}" class="${subGestao === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    <div id="sub"></div>`;
  $('.subabas').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) { subGestao = b.dataset.sub; telaGestao(); } });
  await { lotes: gestaoLotes, usuarios: gestaoUsuarios, convenios: gestaoConvenios }[subGestao]();
}

async function gestaoLotes() {
  $('#sub').innerHTML = `<div class="cartao">
    <h2>Lotes <span class="acoes"><button class="btn btn-perigo btn-mini" id="apagar-demo">Apagar dados de demonstração</button></span></h2>
    <div class="filtros">
      <div class="campo"><label>Faturista</label><select id="g-fat">${opcoesFaturista('')}</select></div>
      <div class="campo"><label>Convênio</label><select id="g-conv">${opcoesConvenio('')}</select></div>
      <div class="campo"><label>Competência</label><input type="month" id="g-comp"></div>
      <div class="campo"><label>Status</label><select id="g-status"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="campo"><label>De</label><input type="date" id="g-ini"></div>
      <div class="campo"><label>Até</label><input type="date" id="g-fim"></div>
      <div class="campo"><label>Buscar lote</label><input id="g-busca" placeholder="Nº do lote"></div>
    </div>
    <div id="g-lista"></div></div>`;
  let lotes = [];
  const carregar = tentar(async () => {
    lotes = await api(`/api/lotes?${qs({ faturista: $('#g-fat').value, convenio: $('#g-conv').value, competencia: $('#g-comp').value, status: $('#g-status').value, inicio: $('#g-ini').value, fim: $('#g-fim').value, busca: $('#g-busca').value })}`);
    $('#g-lista').innerHTML = tabelaLotes(lotes, { gestao: true });
  });
  $$('#sub .filtros select, #sub .filtros input[type=month], #sub .filtros input[type=date]').forEach((el) => el.addEventListener('change', carregar));
  $('#g-busca').addEventListener('input', carregar);
  ligarAcoesLotes($('#g-lista'), () => lotes, carregar);
  $('#apagar-demo').addEventListener('click', tentar(async () => {
    if (!confirm('Apagar todos os lotes de demonstração? Os lotes lançados de verdade ficam.')) return;
    const r = await api('/api/demonstracao', { method: 'DELETE' });
    avisar(`${r.apagados} lote(s) de demonstração apagados.`); carregar();
  }));
  carregar();
}

async function gestaoUsuarios() {
  const usuarios = await api('/api/usuarios');
  const perfis = estado.usuario.perfil === 'diretor' ? Object.keys(PERFIS) : ['faturista'];
  $('#sub').innerHTML = `<div class="cartao">
    <h2>Usuários <button class="btn btn-primario btn-mini" id="novo-usuario">Novo usuário</button></h2>
    <div class="tabela-caixa"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Criado em</th><th></th></tr></thead>
    <tbody>${usuarios.map((u) => `<tr data-id="${u.id}"><td><b>${esc(u.nome)}</b></td><td>${esc(u.login)}</td><td>${PERFIS[u.perfil]}</td>
      <td><span class="selo ${u.ativo ? 'conferido' : 'devolvido'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td><td>${dataBR(u.criado_em.slice(0, 10))}</td>
      <td><div class="acoes">${perfis.includes(u.perfil) ? '<button class="btn btn-claro btn-mini" data-editar>Editar</button>' : ''}</div></td></tr>`).join('')}</tbody></table></div></div>`;

  const form = (u = {}) => `<form>
    <div class="grade">
      <div class="campo"><label>Nome</label><input name="nome" value="${esc(u.nome)}" required></div>
      <div class="campo"><label>Login</label><input name="login" value="${esc(u.login)}" ${u.id ? 'disabled' : 'required'}></div>
      <div class="campo"><label>Perfil</label><select name="perfil">${perfis.map((p) => `<option value="${p}" ${u.perfil === p ? 'selected' : ''}>${PERFIS[p]}</option>`).join('')}</select></div>
      <div class="campo"><label>${u.id ? 'Nova senha (opcional)' : 'Senha'}</label><input name="senha" type="password" minlength="6" ${u.id ? '' : 'required'} autocomplete="new-password"></div>
    </div>
    ${u.id ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ativo" style="width:auto" ${u.ativo ? 'checked' : ''}> Usuário ativo</label>` : ''}
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`;

  $('#novo-usuario').addEventListener('click', () => modal(`<h2>Novo usuário</h2>${form()}`, (el, fechar) => {
    $('form', el).addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      await api('/api/usuarios', { method: 'POST', corpo: Object.fromEntries(new FormData(e.target)) });
      fechar(); avisar('Usuário criado.'); await carregarListas(); gestaoUsuarios();
    }));
  }));
  $('#sub tbody').addEventListener('click', (e) => {
    if (!e.target.closest('[data-editar]')) return;
    const u = usuarios.find((x) => x.id === Number(e.target.closest('tr').dataset.id));
    modal(`<h2>Editar ${esc(u.nome)}</h2>${form(u)}`, (el, fechar) => {
      $('form', el).addEventListener('submit', tentar(async (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        await api(`/api/usuarios/${u.id}`, { method: 'PUT', corpo: { ...f, ativo: !!f.ativo } });
        fechar(); avisar('Usuário atualizado.'); await carregarListas(); gestaoUsuarios();
      }));
    });
  });
}

async function gestaoConvenios() {
  await carregarListas();
  $('#sub').innerHTML = `<div class="cartao">
    <h2>Convênios <button class="btn btn-primario btn-mini" id="novo-conv">Novo convênio</button></h2>
    <p style="color:var(--texto-2);margin:-6px 0 14px;font-size:13px">Convênios novos que aparecem nos PDFs são cadastrados sozinhos ao salvar o lote.</p>
    <div class="tabela-caixa"><table><thead><tr><th>Nome</th><th>Código (registro ANS)</th><th>Situação</th><th></th></tr></thead>
    <tbody>${estado.convenios.map((c) => `<tr data-id="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.codigo || '—')}</td>
      <td><span class="selo ${c.ativo ? 'conferido' : 'devolvido'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td><div class="acoes"><button class="btn btn-claro btn-mini" data-acao="editar">Editar</button><button class="btn btn-perigo btn-mini" data-acao="excluir">Excluir</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = (c = { ativo: 1 }) => `<form><div class="grade">
      <div class="campo"><label>Nome</label><input name="nome" value="${esc(c.nome)}" required></div>
      <div class="campo"><label>Código</label><input name="codigo" value="${esc(c.codigo)}"></div></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ativo" style="width:auto" ${c.ativo ? 'checked' : ''}> Convênio ativo</label>
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`;
  const salvar = (c) => (el, fechar) => $('form', el).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await api(c ? `/api/convenios/${c.id}` : '/api/convenios', { method: c ? 'PUT' : 'POST', corpo: { ...f, ativo: !!f.ativo } });
    fechar(); avisar('Convênio salvo.'); gestaoConvenios();
  }));
  $('#novo-conv').addEventListener('click', () => modal(`<h2>Novo convênio</h2>${form()}`, salvar(null)));
  $('#sub tbody').addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const c = estado.convenios.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (b.dataset.acao === 'editar') modal(`<h2>Editar ${esc(c.nome)}</h2>${form(c)}`, salvar(c));
    else if (confirm(`Excluir o convênio ${c.nome}?`)) { await api(`/api/convenios/${c.id}`, { method: 'DELETE' }); avisar('Convênio excluído.'); gestaoConvenios(); }
  }));
}

// ---------- Gráficos simples ----------
function barras(linhas, rotulo = (l) => l.grupo) {
  if (!linhas.length) return '<div class="vazio">Sem dados no período.</div>';
  const max = Math.max(...linhas.map((l) => l.valor)) || 1;
  return `<div class="barras">${linhas.map((l) => `<div class="barra"><span class="rot" title="${esc(rotulo(l))}">${esc(rotulo(l))}</span>
    <div class="trilho"><div class="cheio" style="width:${(l.valor / max) * 100}%"></div></div>
    <span class="val">${moedaCurta(l.valor)} <small style="color:var(--texto-2);font-weight:400">· ${num(l.guias)} g</small></span></div>`).join('')}</div>`;
}
function colunas(linhas, atual) {
  if (!linhas.length) return '<div class="vazio">Sem dados.</div>';
  const max = Math.max(...linhas.map((l) => l.valor)) || 1;
  return `<div class="colunas">${linhas.map((l) => `<div class="coluna ${l.grupo === atual ? 'atual' : ''}" title="${mesCurto(l.grupo)}: ${moeda(l.valor)} · ${num(l.guias)} guias">
    <em>${moedaCurta(l.valor).replace('R$ ', '')}</em><div class="pilar" style="height:${(l.valor / max) * 78}%"></div><small>${mesCurto(l.grupo)}</small></div>`).join('')}</div>`;
}

// ---------- Aba: Coordenação ----------
const filtroCoord = { inicio: inicioMes(), fim: hoje(), competencia: '', convenio: '', faturista: '', por: 'convenio', producao: 'dia' };
const ROTULOS_POR = { dia: 'Dia', mes: 'Mês', ano: 'Ano', convenio: 'Convênio', competencia: 'Competência', faturista: 'Faturista' };
const rotuloGrupo = (por, g) => (por === 'dia' ? dataBR(g) : por === 'mes' || por === 'competencia' ? compBR(g) : g);

async function telaCoordenacao() {
  const f = filtroCoord;
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Coordenação</h1><p>Produção dos faturistas e relatórios por convênio, competência ou período.</p></div>
      <div class="acoes"><button class="btn btn-claro" id="csv">Exportar planilha (CSV)</button><button class="btn btn-claro" onclick="print()">Imprimir</button></div></div>
    <div class="cartao">
      <div class="acoes" style="justify-content:flex-start;margin-bottom:12px">
        <button class="btn btn-claro btn-mini" data-rapido="hoje">Hoje</button>
        <button class="btn btn-claro btn-mini" data-rapido="mes">Este mês</button>
        <button class="btn btn-claro btn-mini" data-rapido="ano">Este ano</button>
        <button class="btn btn-claro btn-mini" data-rapido="tudo">Tudo</button>
      </div>
      <div class="filtros" style="margin:0">
        <div class="campo"><label>De</label><input type="date" data-f="inicio" value="${f.inicio}"></div>
        <div class="campo"><label>Até</label><input type="date" data-f="fim" value="${f.fim}"></div>
        <div class="campo"><label>Competência</label><input type="month" data-f="competencia" value="${f.competencia}"></div>
        <div class="campo"><label>Convênio</label><select data-f="convenio">${opcoesConvenio(f.convenio)}</select></div>
        <div class="campo"><label>Faturista</label><select data-f="faturista">${opcoesFaturista(f.faturista)}</select></div>
      </div>
    </div>
    <div class="kpis" id="c-kpis"></div>
    <div class="cartao"><h2>Produção por faturista
      <span class="acoes">${['dia', 'mes', 'ano'].map((p) => `<button class="btn btn-mini ${f.producao === p ? 'btn-primario' : 'btn-claro'}" data-producao="${p}">${ROTULOS_POR[p]}</button>`).join('')}</span></h2>
      <div id="c-producao"></div></div>
    <div class="cartao"><h2>Relatório por
      <span class="acoes">${['convenio', 'competencia', 'faturista', 'dia', 'mes', 'ano'].map((p) => `<button class="btn btn-mini ${f.por === p ? 'btn-primario' : 'btn-claro'}" data-por="${p}">${ROTULOS_POR[p]}</button>`).join('')}</span></h2>
      <div id="c-barras" style="margin-bottom:18px"></div><div id="c-tabela"></div></div>`;

  const params = () => ({ inicio: f.inicio, fim: f.fim, competencia: f.competencia, convenio: f.convenio, faturista: f.faturista });
  const carregar = tentar(async () => {
    const [rel, prod] = await Promise.all([
      api(`/api/relatorios?${qs({ ...params(), por: f.por })}`),
      api(`/api/relatorios/producao?${qs({ ...params(), por: f.producao })}`),
    ]);
    const t = rel.totais;
    $('#c-kpis').innerHTML = `
      <div class="kpi destaque"><span>Valor faturado</span><b>${moeda(t.valor)}</b><small>no filtro atual</small></div>
      <div class="kpi"><span>Guias</span><b>${num(t.guias)}</b><small>${num(t.lotes)} lotes</small></div>
      <div class="kpi"><span>Valor médio por guia</span><b>${moeda(t.guias ? t.valor / t.guias : 0)}</b></div>
      <div class="kpi"><span>Guias por lote</span><b>${t.lotes ? (t.guias / t.lotes).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}</b></div>`;

    // Produção: uma linha por período, uma coluna por faturista
    const nomes = [...new Set(prod.map((p) => p.faturista))].sort();
    const grupos = [...new Set(prod.map((p) => p.grupo))];
    const cel = (g, n) => prod.find((p) => p.grupo === g && p.faturista === n);
    const totalNome = (n) => prod.filter((p) => p.faturista === n).reduce((s, p) => ({ guias: s.guias + p.guias, valor: s.valor + p.valor, lotes: s.lotes + p.lotes }), { guias: 0, valor: 0, lotes: 0 });
    const celula = (c) => (c ? `${moeda(c.valor)}<br><small style="color:var(--texto-2)">${num(c.guias)} guias · ${num(c.lotes)} lotes</small>` : '<span style="color:#c0c8d6">—</span>');
    $('#c-producao').innerHTML = !prod.length ? '<div class="vazio">Sem produção no período.</div>' : `<div class="tabela-caixa"><table>
      <thead><tr><th>${ROTULOS_POR[f.producao]}</th>${nomes.map((n) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${grupos.map((g) => {
        const linha = prod.filter((p) => p.grupo === g);
        const tot = linha.reduce((s, p) => ({ guias: s.guias + p.guias, valor: s.valor + p.valor, lotes: s.lotes + p.lotes }), { guias: 0, valor: 0, lotes: 0 });
        return `<tr><td><b>${rotuloGrupo(f.producao, g)}</b></td>${nomes.map((n) => `<td class="num">${celula(cel(g, n))}</td>`).join('')}<td class="num"><b>${celula(tot)}</b></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td>${nomes.map((n) => `<td class="num">${celula(totalNome(n))}</td>`).join('')}<td class="num">${celula(t)}</td></tr></tfoot></table></div>`;

    const rot = (l) => rotuloGrupo(f.por, l.grupo);
    $('#c-barras').innerHTML = barras(rel.linhas.slice(0, 15), rot) + (rel.linhas.length > 15 ? `<p style="color:var(--texto-2);font-size:12px">Mostrando 15 de ${rel.linhas.length}. A tabela ao lado tem todos.</p>` : '');
    $('#c-tabela').innerHTML = !rel.linhas.length ? '' : `<div class="tabela-caixa" style="max-height:420px;overflow:auto"><table>
      <thead><tr><th>${ROTULOS_POR[f.por]}</th><th class="num">Lotes</th><th class="num">Guias</th><th class="num">Valor</th><th class="num">%</th></tr></thead>
      <tbody>${rel.linhas.map((l) => `<tr><td>${esc(rot(l))}</td><td class="num">${num(l.lotes)}</td><td class="num">${num(l.guias)}</td><td class="num">${moeda(l.valor)}</td>
        <td class="num">${t.valor ? ((l.valor / t.valor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}%</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${num(t.lotes)}</td><td class="num">${num(t.guias)}</td><td class="num">${moeda(t.valor)}</td><td class="num">100%</td></tr></tfoot></table></div>`;
  });

  $$('[data-f]').forEach((el) => el.addEventListener('change', () => { f[el.dataset.f] = el.value; carregar(); }));
  $('#conteudo').onclick = (e) => {
    const r = e.target.closest('[data-rapido]');
    const p = e.target.closest('[data-por]');
    const pr = e.target.closest('[data-producao]');
    if (r) {
      const k = r.dataset.rapido;
      f.inicio = k === 'hoje' ? hoje() : k === 'mes' ? inicioMes() : k === 'ano' ? inicioAno() : '';
      f.fim = k === 'tudo' ? '' : hoje();
      if (k === 'hoje') f.producao = 'dia'; else if (k === 'ano') f.producao = 'mes'; else if (k === 'tudo') f.producao = 'ano';
      telaCoordenacao();
    }
    if (p) { f.por = p.dataset.por; telaCoordenacao(); }
    if (pr) { f.producao = pr.dataset.producao; telaCoordenacao(); }
  };
  $('#csv').addEventListener('click', () => { location.href = `/api/relatorios/csv?${qs(params())}`; });
  carregar();
}

// ---------- Aba: Diretoria ----------
async function telaDiretoria() {
  const p = await api('/api/diretoria/painel');
  const a = p.mesAtual;
  const b = p.mesAnterior;
  const c = p.mesAnteriorAteHoje; // mesmo trecho do mês anterior (dia 1 até o dia de hoje)
  const varia = (x, y) => {
    if (!y) return '';
    const v = ((x - y) / y) * 100;
    return `<small class="${v >= 0 ? 'sobe' : 'desce'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs 1–${p.diaHoje} de ${mesCurto(p.anterior)}</small>`;
  };
  const statusTotal = p.status.reduce((s, x) => s + x.lotes, 0) || 1;
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Diretoria</h1><p>Visão geral do faturamento · ${mesCurto(p.atual)}</p></div>
      <div class="acoes"><button class="btn btn-claro" onclick="print()">Imprimir</button></div></div>
    <div class="kpis">
      <div class="kpi destaque"><span>Faturado no mês</span><b>${moeda(a.valor)}</b>${varia(a.valor, c.valor)}</div>
      <div class="kpi"><span>Guias no mês</span><b>${num(a.guias)}</b>${varia(a.guias, c.guias)}</div>
      <div class="kpi"><span>Lotes no mês</span><b>${num(a.lotes)}</b>${varia(a.lotes, c.lotes)}</div>
      <div class="kpi"><span>${mesCurto(p.anterior)} fechado</span><b>${moeda(b.valor)}</b><small>${num(b.guias)} guias · ${num(b.lotes)} lotes</small></div>
    </div>
    <div class="cartao"><h2>Evolução mensal (últimos 12 meses)</h2>${colunas(p.evolucao, p.atual)}</div>
    <div class="duas">
      <div class="cartao"><h2>Convênios no ano</h2>${barras(p.convenios)}</div>
      <div class="cartao"><h2>Equipe no mês</h2>${barras(p.equipe)}
        <h2 style="margin-top:22px">Situação dos lotes</h2>
        <div class="barras">${p.status.map((s) => `<div class="barra"><span class="rot"><span class="selo ${s.grupo}">${STATUS[s.grupo]}</span></span>
          <div class="trilho"><div class="cheio" style="width:${(s.lotes / statusTotal) * 100}%"></div></div><span class="val">${num(s.lotes)} lotes</span></div>`).join('')}</div>
      </div>
    </div>`;
}

// ---------- Início ----------
api('/api/eu').then((u) => { estado.usuario = u; entrar(); }).catch(() => mostrarLogin());
