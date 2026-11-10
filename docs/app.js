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
const PERFIS = { faturista: 'Faturista / XML', supervisora: 'Supervisora', coordenadora: 'Coordenadora', diretor: 'Diretor' };
const STATUS = { lancado: 'Lançado', conferido: 'Conferido', devolvido: 'Devolvido' };
const XML = { enviado: 'XML enviado', pendente: 'XML pendente', na: 'Sem XML' };
const FUNCOES = { faturamento: 'Faturamento', xml: 'Envio de XML', ambos: 'Faturamento e XML' };
const cookie = (nome) => document.cookie.split('; ').find((c) => c.startsWith(`${nome}=`))?.split('=')[1];

async function api(url, opcoes = {}) {
  const o = { ...opcoes, headers: { ...(opcoes.headers || {}) } };
  if (o.corpo !== undefined) { o.body = JSON.stringify(o.corpo); o.headers['Content-Type'] = 'application/json'; }
  if (o.method && o.method !== 'GET') o.headers['X-CSRFToken'] = cookie('csrftoken') || ''; // proteção do Django
  const r = await fetch(url, o);
  if (r.status === 401 && !url.includes('/api/entrar')) { mostrarLogin(); throw new Error('Sessão expirada.'); }
  if (r.status === 428) { trocarSenha(true); throw new Error('Troque sua senha para continuar.'); }
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
  producao: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  diretoria: '<rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/>',
  xml: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  convenios: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
};
const icone = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[n]}</svg>`;
const NOMES_ABAS = { faturamento: 'Faturamento', xml: 'Envio de XML', calendario: 'Calendário', convenios: 'Convênios', gestao: 'Gestão', producao: 'Relatórios', coordenacao: 'Coordenação', diretoria: 'Diretoria' };

// ---------- Estado ----------
const estado = { usuario: null, convenios: [], faturistas: [], aba: null };
const veTodos = () => estado.usuario?.perfil !== 'faturista';

async function carregarListas() {
  [estado.convenios, estado.faturistas] = await Promise.all([api('/api/convenios'), api('/api/pessoas')]);
}
const meusConvenios = (campo) => estado.convenios.filter((c) => c.ativo && c[campo] === estado.usuario.id);
// Prazo do portal: "1 à 7" + selo "aberto hoje"
const prazo = (c) => (c.prazo_texto ? `${esc(c.prazo_texto)}${c.aberto_hoje ? ' <span class="selo conferido">aberto hoje</span>' : ''}` : '<span class="apagado">—</span>');
// "papel": 'fatura' ou 'xml' filtra pela função da pessoa (sem perder quem já está escolhido)
const opcoesPessoa = (sel, vazio = 'Ninguém', papel = '') => `<option value="">${vazio}</option>` +
  estado.faturistas.filter((f) => !papel || f[papel] !== false || String(sel) === String(f.id))
    .map((f) => `<option value="${f.id}" ${String(sel) === String(f.id) ? 'selected' : ''}>${esc(f.nome)}</option>`).join('');
const opcoesConvenio = (sel, todos = true) => (todos ? '<option value="">Todos</option>' : '') +
  estado.convenios.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativo)'}</option>`).join('');
const opcoesFaturista = (sel, todos = true) => (todos ? '<option value="">Todos</option>' : '') +
  estado.faturistas.map((f) => `<option value="${f.id}" ${String(sel) === String(f.id) ? 'selected' : ''}>${esc(f.nome)}</option>`).join('');

// ---------- Login ----------
// Modo demonstração: a tela de entrada é só escolher a pessoa (sem senha).
// Com o modo desligado no servidor, aparece o formulário de usuário e senha.
async function mostrarLogin() {
  $('#tela-app').classList.add('oculto');
  $('#tela-login').classList.remove('oculto');
  const lista = await api('/api/entrar/pessoas').catch(() => []);
  $('#escolher').classList.toggle('oculto', !lista.length);
  $('#form-login').classList.toggle('oculto', !!lista.length);
  const ordem = ['diretor', 'coordenadora', 'supervisora', 'faturista'];
  $('#escolher .pessoas').innerHTML = lista.sort((a, b) => ordem.indexOf(a.perfil) - ordem.indexOf(b.perfil)).map((u) =>
    `<button data-login="${esc(u.login)}" data-nome="${esc(u.nome)}" data-sem-senha="${u.semSenha !== false}"><span class="avatar">${esc(u.nome[0])}</span><b>${esc(u.nome)}</b><small>${PERFIS[u.perfil]}</small></button>`).join('');
  if (!lista.length) $('#login').focus();
  $('#escolher > small').textContent = lista[0]?.semSenha === false ? 'Clique no seu nome e digite a senha' : 'Modo demonstração · acesso sem senha';
}
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    estado.usuario = await api('/api/entrar', { method: 'POST', corpo: { login: $('#login').value, senha: $('#senha').value } });
    $('#senha').value = '';
    entrar();
  } catch (err) { $('#erro-login').textContent = err.message; }
});
// Clicar na pessoa: na demonstração entra direto; no sistema de verdade pede a senha.
$('#escolher').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-login]');
  if (!b) return;
  $('#erro-login').textContent = '';
  if (b.dataset.semSenha !== 'false') {
    try { estado.usuario = await api('/api/entrar', { method: 'POST', corpo: { login: b.dataset.login } }); entrar(); }
    catch (err) { $('#erro-login').textContent = err.message; }
    return;
  }
  modal(`<h2>Olá, ${esc(b.dataset.nome)}</h2><form>
    <div class="campo"><label>Senha</label><input name="senha" type="password" autocomplete="current-password" required autofocus></div>
    <p class="erro-modal"></p>
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Voltar</button><button class="btn btn-primario">Entrar</button></div></form>`,
  (el, fechar) => {
    $('input', el).focus();
    $('form', el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        estado.usuario = await api('/api/entrar', { method: 'POST', corpo: { login: b.dataset.login, senha: ev.target.senha.value } });
        fechar(); entrar();
      } catch (err) { $('.erro-modal', el).textContent = err.message; ev.target.senha.select(); }
    });
  });
});
$('#sair').addEventListener('click', async () => {
  await api('/api/sair', { method: 'POST' });
  estado.usuario = null;
  $('#alertas').innerHTML = '';
  $('#ao-vivo')?.classList.add('oculto');
  mostrarBotaoChat(false);
  chat.com = null;
  vivo.versao = null;
  history.replaceState(null, '', location.pathname);
  mostrarLogin();
});
$('#minha-senha').addEventListener('click', () => trocarSenha(false));

// Troca de senha. "obrigatoria": senha inicial — não dá para fechar nem usar o sistema antes.
function trocarSenha(obrigatoria) {
  if (document.querySelector('.form-senha')) return;
  const fecharModal = modal(`<h2>${obrigatoria ? 'Crie sua senha' : 'Trocar senha'}</h2>
    ${obrigatoria ? '<p class="apagado" style="margin-top:-6px">Você está com a senha inicial. Crie uma senha sua para continuar.</p>' : ''}
    <form class="form-senha">
      <div class="campo"><label>Senha atual${obrigatoria ? ' (a inicial)' : ''}</label><input name="atual" type="password" autocomplete="current-password" required></div>
      <div class="campo"><label>Senha nova (mínimo 6 caracteres)</label><input name="nova" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="campo"><label>Repita a senha nova</label><input name="confirmacao" type="password" minlength="6" autocomplete="new-password" required></div>
      <p class="erro-modal"></p>
      <div class="rodape">${obrigatoria ? '<button type="button" class="btn btn-claro" data-sair-troca>Sair</button>' : '<button type="button" class="btn btn-claro" data-fechar>Cancelar</button>'}
        <button class="btn btn-primario">Salvar senha</button></div></form>`,
  (el, fechar) => {
    if (obrigatoria) {
      el.onmousedown = null; // não fecha clicando fora
      el.addEventListener('mousedown', (ev) => ev.stopImmediatePropagation(), true);
      $('[data-sair-troca]', el).addEventListener('click', () => { fechar(); $('#sair').click(); });
    }
    $('input', el).focus();
    $('form', el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        estado.usuario = await api('/api/senha', { method: 'POST', corpo: Object.fromEntries(new FormData(ev.target)) });
        fechar(); avisar('Senha salva.');
        if (obrigatoria) entrar();
      } catch (err) { $('.erro-modal', el).textContent = err.message; }
    });
  });
  return fecharModal;
}

async function entrar() {
  $('#tela-login').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');
  const u = estado.usuario;
  $('#minha-senha').classList.toggle('oculto', !!u.modoDemo);
  mostrarBotaoChat(!u.trocarSenha);
  contarNaoLidas();
  if (u.trocarSenha) {
    $('#nome-usuario').textContent = u.nome;
    $('#perfil-usuario').textContent = PERFIS[u.perfil];
    $('#abas').innerHTML = '';
    $('#conteudo').innerHTML = '';
    return trocarSenha(true);
  }
  $('#nome-usuario').textContent = u.nome;
  $('#perfil-usuario').textContent = PERFIS[u.perfil];
  $('#abas').innerHTML = u.abas.map((a) => `<button class="aba" data-aba="${a}">${icone(a)}${NOMES_ABAS[a]}</button>`).join('');
  await carregarListas();
  const salva = location.hash.slice(1);
  // Abre na aba "mais alta" do perfil (diretor → Diretoria…). Faturista/XML: Faturamento se fatura
  // algum convênio, senão Envio de XML.
  let aba = u.abas.filter((a) => !['calendario', 'convenios'].includes(a)).pop();
  if (u.perfil === 'faturista') aba = meusConvenios('faturista_id').length || !meusConvenios('xml_id').length ? 'faturamento' : 'xml';
  if (!u.abas.includes(aba)) aba = u.abas[0];
  abrirAba(u.abas.includes(salva) ? salva : aba);
}
$('#abas').addEventListener('click', (e) => { const b = e.target.closest('[data-aba]'); if (b) abrirAba(b.dataset.aba); });

function abrirAba(aba) {
  estado.aba = aba;
  $('#conteudo').onclick = null;
  $('#conteudo').onchange = null;
  history.replaceState(null, '', `#${aba}`);
  $$('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  carregarAlertas();
  vivo.pendente = false;
  verificarMudancas();
  const telas = { faturamento: telaFaturamento, xml: telaXml, calendario: telaCalendario, convenios: telaConvenios, gestao: telaGestao, producao: telaCoordenacao, coordenacao: telaCoordenacao, diretoria: telaDiretoria };
  tentar(telas[aba])();
}

// ---------- Tabelas responsivas ----------
// Cada célula ganha o nome da coluna (data-rotulo). Quando a tabela não cabe, o CSS
// transforma cada linha num cartão com "Coluna: valor" (ver .tabela-caixa no styles.css).
function rotularTabelas(raiz = document) {
  for (const t of raiz.querySelectorAll('.tabela-caixa table')) {
    const nomes = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr, tfoot tr')) {
      let i = 0;
      for (const td of tr.children) {
        const nome = nomes[i] || '';
        if (td.dataset.rotulo !== nome) td.dataset.rotulo = nome;
        i += Number(td.getAttribute('colspan') || 1);
      }
    }
  }
}
new MutationObserver(() => rotularTabelas()).observe(document.body, { childList: true, subtree: true });

// ---------- Mensagens entre a equipe ----------
// Botão no canto com o número de não lidas. Conversa "Equipe toda" e conversas individuais.
// Com a conversa aberta, as mensagens novas chegam a cada 4 s.
const chat = { aberto: false, com: null, nome: '', ultimo: 0, timer: null };

function montarChat() {
  if ($('#chat-botao')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="chat-botao" class="oculto" title="Mensagens"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="chat-conta oculto"></span></button>
    <section id="chat" class="oculto" aria-label="Mensagens">
      <header><button class="chat-voltar oculto" title="Voltar">‹</button><b id="chat-titulo">Mensagens</b><button class="chat-fechar" title="Fechar">×</button></header>
      <div id="chat-corpo"></div>
      <form id="chat-form" class="oculto"><textarea name="texto" rows="1" placeholder="Escreva uma mensagem…" maxlength="2000"></textarea><button class="btn btn-primario">Enviar</button></form>
    </section>`);
  $('#chat-botao').addEventListener('click', () => (chat.aberto ? fecharChat() : abrirChat()));
  $('#chat .chat-fechar').addEventListener('click', fecharChat);
  $('#chat .chat-voltar').addEventListener('click', () => listarConversas());
  $('#chat-corpo').addEventListener('click', (e) => { const c = e.target.closest('[data-com]'); if (c) abrirConversa(c.dataset.com, c.dataset.nome); });
  const form = $('#chat-form');
  form.texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const texto = form.texto.value.trim();
    if (!texto) return;
    form.texto.value = '';
    await api('/api/mensagens', { method: 'POST', corpo: { com: chat.com, texto } });
    await buscarNovas();
  }));
}
function mostrarBotaoChat(sim) { montarChat(); $('#chat-botao').classList.toggle('oculto', !sim); if (!sim) fecharChat(); }
async function contarNaoLidas() {
  if (!estado.usuario || estado.usuario.trocarSenha) return;
  try {
    const r = await api('/api/mensagens/resumo');
    const el = $('#chat-botao .chat-conta');
    el.textContent = r.naoLidas > 99 ? '99+' : r.naoLidas;
    el.classList.toggle('oculto', !r.naoLidas);
  } catch {}
}
function abrirChat() { chat.aberto = true; $('#chat').classList.remove('oculto'); chat.com ? abrirConversa(chat.com, chat.nome) : listarConversas(); }
function fecharChat() { chat.aberto = false; clearInterval(chat.timer); $('#chat')?.classList.add('oculto'); }
const horaMsg = (iso) => {
  const d = new Date(iso);
  return isoLocal(d) === hoje() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : `${dataBR(isoLocal(d)).slice(0, 5)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const tentarChat = (fn) => tentar(fn);
const listarConversas = tentarChat(async () => {
  clearInterval(chat.timer);
  chat.com = null;
  $('#chat-titulo').textContent = 'Mensagens';
  $('#chat .chat-voltar').classList.add('oculto');
  $('#chat-form').classList.add('oculto');
  const lista = await api('/api/mensagens/conversas');
  $('#chat-corpo').innerHTML = `<ul class="chat-lista">${lista.map((c) => `<li data-com="${c.chave}" data-nome="${esc(c.nome)}">
      <span class="avatar ${c.chave === 'equipe' ? 'equipe' : ''}">${c.chave === 'equipe' ? '👥' : esc(c.nome[0])}</span>
      <div><b>${esc(c.nome)}</b><small>${c.ultima ? `${c.ultima.minha ? 'Você' : esc(c.ultima.autor.split(' ')[0])}: ${esc(c.ultima.texto.slice(0, 60))}` : (c.perfil ? PERFIS[c.perfil] : 'Recados para todo mundo')}</small></div>
      ${c.naoLidas ? `<span class="chat-conta">${c.naoLidas}</span>` : ''}</li>`).join('')}</ul>`;
  contarNaoLidas();
});
const abrirConversa = tentarChat(async (com, nome) => {
  chat.com = com; chat.nome = nome; chat.ultimo = 0;
  $('#chat-titulo').textContent = nome;
  $('#chat .chat-voltar').classList.remove('oculto');
  $('#chat-form').classList.remove('oculto');
  $('#chat-corpo').innerHTML = '<div class="chat-msgs"></div>';
  await buscarNovas();
  $('#chat-form').texto.focus();
  clearInterval(chat.timer);
  chat.timer = setInterval(() => { if (!document.hidden) buscarNovas(); }, 4000);
});
async function buscarNovas() {
  if (!chat.com) return;
  let novas;
  try { novas = await api(`/api/mensagens?com=${chat.com}${chat.ultimo ? `&depois=${chat.ultimo}` : ''}`); } catch { return; }
  const caixa = $('#chat-corpo .chat-msgs');
  if (!caixa) return;
  if (!novas.length && !chat.ultimo) caixa.innerHTML = `<div class="vazio">Nenhuma mensagem ainda. ${chat.com === 'equipe' ? 'O que você escrever aqui todo mundo vê.' : 'Só vocês dois veem esta conversa.'}</div>`;
  if (novas.length) {
    if (!chat.ultimo) caixa.innerHTML = '';
    const embaixo = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 60;
    caixa.insertAdjacentHTML('beforeend', novas.map((m) => `<div class="msg ${m.minha ? 'minha' : ''}">
      ${!m.minha && chat.com === 'equipe' ? `<small class="msg-autor">${esc(m.autor)}</small>` : ''}
      <div class="msg-texto">${esc(m.texto).replace(/\n/g, '<br>')}</div><small class="msg-hora">${horaMsg(m.criado_em)}</small></div>`).join(''));
    chat.ultimo = novas.at(-1).id;
    if (embaixo || novas.some((m) => m.minha) || novas.length === caixa.children.length) caixa.scrollTop = caixa.scrollHeight;
    contarNaoLidas();
  }
}

// ---------- Tempo real ----------
// A cada 10 s pergunta ao servidor se algo mudou (lote lançado, conferido, XML enviado, entrega marcada).
// Telas de acompanhamento se redesenham sozinhas; nas de trabalho (Faturamento, Gestão) aparece "Atualizar".
const AUTO = ['producao', 'coordenacao', 'diretoria', 'xml', 'calendario'];
const vivo = { versao: null, pendente: false };
const horaAgora = () => new Date().toLocaleTimeString('pt-BR');
function mostrarVivo(texto, comBotao = false) {
  let el = $('#ao-vivo');
  if (!el) { el = document.createElement('div'); el.id = 'ao-vivo'; document.body.append(el); }
  el.innerHTML = `<span class="pulso"></span>${texto}${comBotao ? ' <button type="button" data-atualizar>Atualizar</button>' : ''}`;
  el.classList.toggle('novo', comBotao);
  el.classList.toggle('oculto', !estado.usuario || estado.usuario.trocarSenha);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#ao-vivo [data-atualizar]')) { vivo.pendente = false; redesenharAoVivo(); }
});
async function redesenharAoVivo() {
  const y = window.scrollY;
  await abrirAba(estado.aba);
  window.scrollTo(0, y);
  mostrarVivo(`Ao vivo · atualizado às ${horaAgora()}`);
}
const ocupado = () => document.querySelector('.fundo-modal')
  || (document.activeElement && document.activeElement.closest('#conteudo') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))
  || ($('#revisao') && $('#revisao').innerHTML.trim()) || ($('#x-revisao') && $('#x-revisao').innerHTML.trim());
async function verificarMudancas() {
  if (!estado.usuario || estado.usuario.trocarSenha || document.hidden) return;
  contarNaoLidas();
  let r;
  try { r = await api('/api/versao'); } catch { return; }
  if (vivo.versao === null) { vivo.versao = r.versao; mostrarVivo(`Ao vivo · atualizado às ${horaAgora()}`); return; }
  if (r.versao === vivo.versao && !vivo.pendente) { mostrarVivo(`Ao vivo · conferido às ${horaAgora()}`); return; }
  vivo.versao = r.versao;
  carregarAlertas();
  if (AUTO.includes(estado.aba) && !ocupado()) { vivo.pendente = false; return redesenharAoVivo(); }
  vivo.pendente = true;
  mostrarVivo('Há lançamentos novos', true);
}
setInterval(verificarMudancas, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) verificarMudancas(); });

// ---------- Alertas: último dia do portal e próximo envio ----------
// Aparecem no topo de todas as telas. O × esconde até o dia seguinte (só neste navegador).
const chaveAlerta = (a, dia) => `alerta:${dia}:${a.titulo}`;
async function carregarAlertas() {
  let r;
  try { r = await api('/api/alertas'); } catch { return; }
  const escondido = (a) => { try { return sessionStorage.getItem(chaveAlerta(a, r.hoje)) === '1'; } catch { return false; } };
  const visiveis = r.alertas.filter((a) => !escondido(a));
  $('#alertas').innerHTML = visiveis.map((a) => `<div class="alerta ${a.nivel}" data-chave="${esc(chaveAlerta(a, r.hoje))}">
      <span class="alerta-icone">${a.nivel === 'urgente' ? '!' : a.nivel === 'atencao' ? '⏰' : 'ℹ'}</span>
      <div><b>${esc(a.titulo)}</b><span>${a.itens.slice(0, 10).map(esc).join(', ')}${a.itens.length > 10 ? ` e mais ${a.itens.length - 10}` : ''}</span></div>
      ${a.aba ? `<button class="btn btn-claro btn-mini" data-ir="${a.aba}">${a.aba === 'calendario' ? 'Ver calendário' : 'Ver lotes'}</button>` : ''}
      <button class="fechar-alerta" title="Esconder até amanhã" data-fechar-alerta>×</button></div>`).join('');
  // Bolinha vermelha na aba Calendário quando há algo para hoje
  $('[data-aba=calendario]')?.classList.toggle('com-alerta', r.alertas.some((a) => a.nivel === 'urgente'));
}
$('#alertas').addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) return abrirAba(ir.dataset.ir);
  const fechar = e.target.closest('[data-fechar-alerta]');
  if (fechar) {
    const caixa = fechar.closest('.alerta');
    try { sessionStorage.setItem(caixa.dataset.chave, '1'); } catch {}
    caixa.remove();
  }
});

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
      <div class="campo"><label>Produção de (quem gerou)</label><select name="faturistaId">${opcoesFaturista(d.faturistaId || estado.usuario.id, false)}</select>
        ${d.geradoPor ? `<div class="guias-regra">No PDF (${esc(d.geradoPorOrigem)}): ${esc(d.geradoPor)}${d.faturistaNome ? ` → ${esc(d.faturistaNome)}` : ' · não cadastrado'}</div>`
          : d.gerado_por ? `<div class="guias-regra">No PDF: ${esc(d.gerado_por)}</div>` : ''}</div>
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
    tipo: l.tipo, faturistaId: l.faturista_id, observacao: l.observacao, gerado_por: l.gerado_por,
  };
  modal(`<h2>Editar lote ${esc(l.numero_lote)}</h2><form>${formLote(dados)}
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`,
  (el, fechar) => {
    $('form', el).addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const r = await api(`/api/lotes/${l.id}`, { method: 'PUT', corpo: lerFormLote(e.target) });
      fechar(); avisar(r.xmlAmarrados ? 'Lote atualizado e amarrado ao XML já enviado.' : 'Lote atualizado.'); depois();
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
      <th class="num">Guias</th><th class="num">Valor</th><th>Status</th><th>XML</th><th></th></tr></thead>
    <tbody>${lotes.map((l) => `<tr data-id="${l.id}">
      <td><b>${esc(l.numero_lote)}</b>${l.demo ? '<span class="selo demo">demo</span>' : ''}
        ${!gestao && l.faturista_id !== estado.usuario.id ? `<br><small class="apagado">produção de ${esc(l.faturista)}</small>` : ''}</td>
      <td>${esc(l.convenio)}</td>${gestao ? `<td>${esc(l.faturista)}</td>` : ''}
      <td>${compBR(l.competencia)}</td><td>${dataBR(l.data_lancamento)}</td>
      <td class="num">${num(l.qtd_guias)}</td><td class="num">${moeda(l.valor_total)}</td>
      <td><span class="selo ${l.status}" title="${esc(l.observacao)}">${STATUS[l.status]}</span>
        ${l.status === 'devolvido' && l.observacao ? `<br><small style="color:var(--vermelho)">${esc(l.observacao)}</small>` : ''}</td>
      <td><span class="selo xml-${l.xml}">${XML[l.xml]}</span>${l.valor_convenio != null
        ? `<br><span class="selo devolvido" title="O protocolo do convênio veio com outro valor. Confira e corrija o lote.">Convênio: ${moeda(l.valor_convenio)}</span>` : ''}</td>
      <td><div class="acoes">
        ${!gestao && l.xml === 'pendente' ? '<button class="btn btn-primario btn-mini" data-acao="protocolo">Anexar protocolo</button>' : ''}
        ${l.arquivo ? `<a class="btn btn-claro btn-mini" href="/api/lotes/${l.id}/pdf" target="_blank">PDF</a>` : ''}
        ${gestao && l.status !== 'conferido' ? '<button class="btn btn-claro btn-mini" data-acao="conferir">Conferir</button>' : ''}
        ${gestao && l.status !== 'devolvido' ? '<button class="btn btn-claro btn-mini" data-acao="devolver">Devolver</button>' : ''}
        ${gestao || l.status !== 'conferido' ? `<button class="btn btn-claro btn-mini" data-acao="editar">Editar</button>
          <button class="btn btn-perigo btn-mini" data-acao="excluir">Excluir</button>` : ''}
      </div></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${gestao ? 5 : 4}">${num(lotes.length)} lote(s)</td><td class="num">${num(tG)}</td><td class="num">${moeda(tV)}</td><td colspan="3"></td></tr></tfoot>
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
    if (acao === 'protocolo') estado.anexarProtocolo?.(l);
    if (acao === 'conferir') { await api(`/api/lotes/${l.id}/status`, { method: 'PATCH', corpo: { status: 'conferido' } }); avisar('Lote conferido.'); recarregar(); }
    if (acao === 'devolver') {
      const motivo = prompt('Motivo da devolução (aparece para o faturista):', l.observacao || '');
      if (motivo === null) return;
      await api(`/api/lotes/${l.id}/status`, { method: 'PATCH', corpo: { status: 'devolvido', observacao: motivo } });
      avisar('Lote devolvido.'); recarregar();
    }
  }));
}

// Lista de convênios da pessoa com o prazo do portal (do calendário)
function cartaoConvenios(titulo, lista) {
  if (!lista.length) {
    return `<div class="cartao"><h2>${titulo}</h2><div class="apagado">A coordenação ainda não distribuiu convênios para você.</div></div>`;
  }
  const ordenada = [...lista].sort((a, b) => b.aberto_hoje - a.aberto_hoje || a.nome.localeCompare(b.nome));
  return `<div class="cartao"><h2>${titulo} <small class="apagado">${lista.length} convênio(s) · prazo do portal</small></h2>
    <div class="chips">${ordenada.map((c) => `<span class="chip ${c.aberto_hoje ? 'aberto' : ''}"><b>${esc(c.nome)}</b>
      <small>${c.prazo_texto ? esc(c.prazo_texto) : 'sem prazo'}${c.aberto_hoje ? ' · aberto hoje' : ''}${c.tem_xml ? '' : ' · sem XML'}</small></span>`).join('')}</div></div>`;
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
    <div class="topo"><div><h1>Faturamento</h1><p>Olá, ${esc(eu.nome)}. Envie o protocolo do lote e confira os dados antes de salvar.</p></div></div>
    <div class="kpis">${kpi('Minha produção hoje', dia)}${kpi('Neste mês', mes)}${kpi('Neste ano', ano)}</div>
    ${cartaoConvenios('Convênios que eu faturo', meusConvenios('faturista_id'))}
    <div class="cartao">
      <h2>Novo lote</h2>
      <label class="solta" id="solta">
        ${icone('upload')}
        <b>Arraste o protocolo do lote aqui (PDF ou foto)</b>
        <span>ou clique para escolher · lê lote, convênio, guias, valor e quem gerou · escaneado ou foto passa por OCR</span>
        <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg" hidden id="arquivo">
      </label>
      <div id="revisao"></div>
    </div>
    <div class="cartao">
      <h2>Protocolo do convênio <small class="apagado">comprovante do portal · confere o valor com o lote</small></h2>
      <label class="solta" id="p-solta">
        ${icone('upload')}
        <b>Arraste aqui o protocolo do convênio</b>
        <span>PDF, foto ou o arquivo XML · o sistema acha o seu lote pelo número e compara o valor</span>
        <input type="file" accept=".pdf,.xml,.png,.jpg,.jpeg,application/pdf,text/xml,image/*" hidden id="p-arquivo">
      </label>
      <div id="p-revisao"></div>
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
    lotes = await api(`/api/lotes?${qs({ ...meu, meus: 1, competencia: $('#f-comp').value, convenio: $('#f-conv').value, status: $('#f-status').value, busca: $('#f-busca').value })}`);
    $('#lista').innerHTML = tabelaLotes(lotes);
  });
  ['#f-comp', '#f-conv', '#f-status'].forEach((s) => $(s).addEventListener('change', carregar));
  $('#f-busca').addEventListener('input', carregar);
  ligarAcoesLotes($('#lista'), () => lotes, () => telaFaturamento());
  carregar();

  const solta = $('#solta');
  const enviar = tentar(async (arquivo) => {
    if (!arquivo) return;
    $('#revisao').innerHTML = '<div class="vazio">Lendo o protocolo… (escaneado ou foto leva alguns segundos)</div>';
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

  // Protocolo do convênio: o faturista anexa; se o valor for diferente do lote, avisa na hora
  let loteEscolhido = null;
  estado.anexarProtocolo = (l) => { loteEscolhido = l; $('#p-arquivo').click(); };
  const psolta = $('#p-solta');
  const lerProtocolo = tentar(async (arquivo) => {
    if (!arquivo) return;
    $('#p-revisao').innerHTML = '<div class="vazio">Lendo o protocolo…</div>';
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    let d;
    try { d = await api('/api/xml/ler?contexto=faturamento', { method: 'POST', body: fd }); }
    catch (e) { $('#p-revisao').innerHTML = ''; throw e; }
    if (loteEscolhido && (!d.loteId || d.loteId !== loteEscolhido.id)) {
      if (d.loteId) d.avisos.unshift(`O arquivo indica o lote ${d.numeroLote}, não o ${loteEscolhido.numero_lote} que você escolheu. Confira.`);
      else Object.assign(d, { loteId: loteEscolhido.id, numeroLote: loteEscolhido.numero_lote, convenioId: loteEscolhido.convenio_id, avisos: [],
        candidatos: [{ ...loteEscolhido, valor_total: loteEscolhido.valor_total }] });
    }
    loteEscolhido = null;
    revisaoProtocolo(d);
  });
  psolta.addEventListener('dragover', (e) => { e.preventDefault(); psolta.classList.add('arrastando'); });
  psolta.addEventListener('dragleave', () => psolta.classList.remove('arrastando'));
  psolta.addEventListener('drop', (e) => { e.preventDefault(); psolta.classList.remove('arrastando'); lerProtocolo(e.dataTransfer.files[0]); });
  $('#p-arquivo').addEventListener('change', (e) => { lerProtocolo(e.target.files[0]); e.target.value = ''; });

  function revisaoProtocolo(d) {
    const escolher = d.candidatos.length > 1;
    const lote = d.candidatos.find((c) => c.id === d.loteId) || (!escolher && d.candidatos[0]);
    const cand = (l) => `${esc(l.numero_lote)} · ${esc(l.convenio)} · ${l.valor_total != null ? moeda(l.valor_total) : ''} · lançado em ${dataBR(l.data_lancamento)}`;
    $('#p-revisao').innerHTML = `<form style="margin-top:18px">
      ${d.avisos.length ? `<div class="avisos">${d.avisos.map(esc).join('<br>')}</div>` : ''}
      ${lote && !escolher ? `<div class="avisos ok">Lote encontrado: <b>${cand(lote)}</b></div>` : ''}
      ${escolher ? `<div class="campo"><label>Mais de um lote combina. Qual é?</label>${d.candidatos.map((l, i) =>
        `<label class="opcao"><input type="radio" name="loteId" value="${l.id}" ${i === 0 ? 'checked' : ''}> ${cand(l)}</label>`).join('')}</div>` : ''}
      <div class="grade">
        <div class="campo"><label>Nº do lote</label><input name="numeroLote" value="${esc(d.numeroLote)}" ${escolher ? 'disabled' : 'required'}></div>
        <div class="campo"><label>Convênio</label><select name="convenioId" ${escolher ? 'disabled' : 'required'}><option value="">Selecione…</option>
          ${estado.convenios.filter((c) => c.tem_xml || c.id === d.convenioId).map((c) => `<option value="${c.id}" ${c.id === d.convenioId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Valor no protocolo do convênio (R$)</label><input name="valorProtocolo" inputmode="decimal" required value="${d.valorProtocolo != null ? valorBR(d.valorProtocolo) : ''}" placeholder="0,00"></div>
        <div class="campo"><label>Nº do protocolo (opcional)</label><input name="protocolo" value="${esc(d.protocolo)}"></div>
        <div class="campo"><label>Data</label><input name="dataEnvio" type="date" value="${hoje()}" required></div>
      </div>
      <p class="apagado" id="p-compara" style="margin:0 0 12px"></p>
      <div class="acoes"><button type="button" class="btn btn-claro" data-cancelar>Cancelar</button><button class="btn btn-primario">Salvar protocolo</button></div></form>`;
    const form = $('#p-revisao form');
    // Compara na hora com o valor do lote
    const comparar = () => {
      const escolhido = escolher ? d.candidatos.find((c) => String(c.id) === form.loteId.value) : lote;
      const v = lerValor(form.valorProtocolo.value || 'x');
      const el = $('#p-compara');
      if (!escolhido || escolhido.valor_total == null || Number.isNaN(v)) { el.textContent = ''; return; }
      const igual = Math.abs(v - escolhido.valor_total) < 0.01;
      el.innerHTML = igual ? `<span class="selo conferido">Valor confere com o lote (${moeda(escolhido.valor_total)})</span>`
        : `<span class="selo devolvido">Diferente do lote: sistema ${moeda(escolhido.valor_total)} · convênio ${moeda(v)} — corrija o lote</span>`;
    };
    form.addEventListener('input', comparar);
    comparar();
    $('[data-cancelar]', form).addEventListener('click', () => { $('#p-revisao').innerHTML = ''; });
    form.addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const mesmo = !escolher && v.numeroLote === d.numeroLote && Number(v.convenioId) === d.convenioId;
      const r = await api('/api/xml', { method: 'POST', corpo: { ...v, arquivoId: d.arquivoId, nomeArquivo: d.nomeArquivo, loteId: escolher ? v.loteId : mesmo ? d.loteId : null } });
      if (r.divergente) avisar(`Protocolo salvo. O valor é diferente do lote ${r.numeroLote}: corrija o lote.`, true);
      else avisar(r.amarrado ? `Protocolo do lote ${r.numeroLote} salvo. Valor confere.` : `Protocolo salvo. Vai amarrar quando o lote ${r.numeroLote} for lançado.`);
      telaFaturamento(); carregarAlertas();
    }));
    $('#p-revisao').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function mostrarRevisao(d) {
    const avisos = d.avisos.length
      ? `<div class="avisos">${d.avisos.map(esc).join('<br>')}</div>`
      : `<div class="avisos ok">Leitura completa de <b>${esc(d.nomeArquivo)}</b>${d.prestador ? ` · ${esc(d.prestador)}` : ''}. Confira e salve.</div>`;
    $('#revisao').innerHTML = `<form style="margin-top:18px">${avisos}${formLote(d)}
      <div class="acoes"><button type="button" class="btn btn-claro" id="cancelar">Cancelar</button><button class="btn btn-primario">Salvar lote</button></div></form>`;
    $('#cancelar').addEventListener('click', () => { $('#revisao').innerHTML = ''; });
    $('#revisao form').addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const corpo = lerFormLote(e.target, { arquivoId: d.arquivoId, guiasTexto: d.guiasTexto, prestador: d.prestador,
        convenioNome: d.convenioNome, convenioCodigo: d.convenioCodigo, geradoPor: d.geradoPor });
      const r = await api('/api/lotes', { method: 'POST', corpo });
      const dono = estado.faturistas.find((p) => String(p.id) === String(corpo.faturistaId));
      const deOutro = dono && dono.id !== estado.usuario.id ? ` na produção de ${dono.nome}` : '';
      avisar(r.xmlAmarrados ? `Lote ${corpo.numeroLote} salvo${deOutro} e amarrado ao XML já enviado.` : `Lote ${corpo.numeroLote} salvo${deOutro}.`);
      await carregarListas();
      telaFaturamento();
    }));
  }
}

// ---------- Aba: Envio de XML ----------
// Quem passa o XML anexa o protocolo; o sistema acha o lote pelo número e amarra.
// Se o lote ainda não foi lançado, o envio fica "aguardando" e amarra sozinho quando o faturista lançar.
const filtroXml = { responsavel: '', situacao: '', busca: '' };

async function telaXml() {
  const todos = veTodos();
  const f = filtroXml;
  const res = await api(`/api/xml/resumo?${qs({ responsavel: todos ? f.responsavel : '' })}`);
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Envio de XML</h1><p>Anexe o protocolo do envio. O sistema acha o lote pelo número e amarra sozinho.</p></div>
      ${todos ? `<div class="campo" style="margin:0;min-width:220px"><label>Responsável pelo XML</label><select id="x-resp">${opcoesPessoa(f.responsavel, 'Toda a equipe')}</select></div>` : ''}</div>
    <div class="kpis">
      <div class="kpi destaque"><span>Lotes aguardando XML</span><b>${num(res.pendentes)}</b><small>${res.pendentesValor == null ? 'lançados pelo faturamento' : `${moeda(res.pendentesValor)} em lotes lançados`}</small></div>
      <div class="kpi"><span>XML enviados no mês</span><b>${num(res.enviadosMes)}</b></div>
      <div class="kpi"><span>Protocolos esperando o lote</span><b>${num(res.aguardandoLote)}</b><small>XML enviado antes do lançamento</small></div>
    </div>
    ${todos ? '' : cartaoConvenios('Convênios em que passo o XML', meusConvenios('xml_id'))}
    <div class="cartao">
      <h2>Anexar protocolo do XML</h2>
      <label class="solta" id="x-solta">
        ${icone('upload')}
        <b>Arraste o protocolo aqui</b>
        <span>PDF, foto ou o próprio arquivo XML · o sistema procura o número do lote</span>
        <input type="file" accept=".pdf,.xml,.png,.jpg,.jpeg,application/pdf,text/xml,image/*" hidden id="x-arquivo">
      </label>
      <div id="x-revisao"></div>
    </div>
    <div class="cartao"><h2>Lotes lançados aguardando XML</h2><div id="x-pend"></div></div>
    <div class="cartao">
      <h2>Envios registrados</h2>
      <div class="filtros">
        <div class="campo"><label>Situação</label><select id="x-sit">
          <option value="">Todos</option><option value="amarrado" ${f.situacao === 'amarrado' ? 'selected' : ''}>Amarrado ao lote</option>
          <option value="aguardando" ${f.situacao === 'aguardando' ? 'selected' : ''}>Esperando o lote</option></select></div>
        <div class="campo"><label>Buscar</label><input id="x-busca" placeholder="Nº do lote ou protocolo" value="${esc(f.busca)}"></div>
      </div>
      <div id="x-envios"></div>
    </div>`;

  let pendentes = [];
  let envios = [];
  const carregarPendentes = tentar(async () => {
    pendentes = await api(`/api/xml/pendentes?${qs({ responsavel: todos ? f.responsavel : '' })}`);
    $('#x-pend').innerHTML = !pendentes.length ? '<div class="vazio">Nenhum lote esperando XML. 🎉</div>' : `<div class="tabela-caixa" style="max-height:420px;overflow:auto"><table>
      <thead><tr><th>Lote</th><th>Convênio</th><th>Faturista</th>${todos ? '<th>XML com</th>' : ''}<th>Lançado em</th><th class="num">Guias</th><th class="num">Valor</th><th>Prazo do portal</th><th></th></tr></thead>
      <tbody>${pendentes.map((l) => `<tr data-id="${l.id}"><td><b>${esc(l.numero_lote)}</b></td><td>${esc(l.convenio)}</td><td>${esc(l.faturista)}</td>
        ${todos ? `<td>${esc(l.responsavel_xml || '—')}</td>` : ''}<td>${dataBR(l.data_lancamento)}</td>
        <td class="num">${l.qtd_guias == null ? '—' : num(l.qtd_guias)}</td><td class="num">${l.valor_total == null ? '—' : moeda(l.valor_total)}</td>
        <td>${l.prazo_texto ? esc(l.prazo_texto) : '—'}${l.aberto_hoje ? ' <span class="selo conferido">aberto hoje</span>' : ''}</td>
        <td><div class="acoes"><button class="btn btn-primario btn-mini" data-anexar>Anexar protocolo</button>
          <button class="btn btn-claro btn-mini" data-marcar>Marcar enviado</button></div></td></tr>`).join('')}</tbody></table></div>`;
  });
  const carregarEnvios = tentar(async () => {
    envios = await api(`/api/xml?${qs({ responsavel: todos ? f.responsavel : '', situacao: f.situacao, busca: f.busca })}`);
    $('#x-envios').innerHTML = !envios.length ? '<div class="vazio">Nenhum envio registrado.</div>' : `<div class="tabela-caixa" style="max-height:480px;overflow:auto"><table>
      <thead><tr><th>Enviado em</th><th>Lote</th><th>Convênio</th>${todos ? '<th>Quem enviou</th>' : ''}<th>Situação</th><th>Protocolo</th><th></th></tr></thead>
      <tbody>${envios.map((e) => `<tr data-id="${e.id}"><td>${dataBR(e.data_envio)}</td>
        <td><b>${esc(e.numero_lote)}</b>${e.demo ? '<span class="selo demo">demo</span>' : ''}</td><td>${esc(e.convenio)}</td>
        ${todos ? `<td>${esc(e.responsavel)}</td>` : ''}
        <td>${e.lote_id ? `<span class="selo conferido">Amarrado</span> <small class="apagado">${e.lote_valor == null ? '' : `${num(e.lote_guias)} guias · ${moeda(e.lote_valor)} · `}${esc(e.faturista)}</small>`
          : '<span class="selo lancado">Esperando o lote</span>'}</td>
        <td>${esc(e.protocolo || '—')}${e.valor_protocolo != null ? `<br><small class="apagado">${moeda(e.valor_protocolo)}</small>` : ''}
          ${e.divergente ? '<br><span class="selo devolvido">valor diferente do lote</span>' : ''}</td>
        <td><div class="acoes">${e.arquivo ? `<a class="btn btn-claro btn-mini" href="/api/xml/${e.id}/arquivo" target="_blank">Arquivo</a>` : ''}
          <button class="btn btn-claro btn-mini" data-editar>Editar</button><button class="btn btn-perigo btn-mini" data-excluir>Excluir</button></div></td></tr>`).join('')}</tbody></table></div>`;
  });
  const recarregar = () => telaXml();

  $('#x-resp')?.addEventListener('change', (e) => { f.responsavel = e.target.value; telaXml(); });
  $('#x-sit').addEventListener('change', (e) => { f.situacao = e.target.value; carregarEnvios(); });
  $('#x-busca').addEventListener('input', (e) => { f.busca = e.target.value; carregarEnvios(); });

  // Anexar: lê o arquivo e mostra o que achou. "loteEscolhido" vem do botão da fila de pendentes.
  let loteEscolhido = null;
  const solta = $('#x-solta');
  const ler = tentar(async (arquivo) => {
    if (!arquivo) return;
    $('#x-revisao').innerHTML = '<div class="vazio">Lendo o protocolo…</div>';
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    let d;
    try { d = await api('/api/xml/ler', { method: 'POST', body: fd }); }
    catch (e) { $('#x-revisao').innerHTML = ''; throw e; }
    if (loteEscolhido) {
      if (d.loteId && d.loteId !== loteEscolhido.id) {
        d.avisos.unshift(`O arquivo indica o lote ${d.numeroLote}, não o ${loteEscolhido.numero_lote} que você escolheu. Confira.`);
      } else if (!d.loteId) {
        Object.assign(d, { loteId: loteEscolhido.id, numeroLote: loteEscolhido.numero_lote, convenioId: loteEscolhido.convenio_id,
          candidatos: [loteEscolhido], avisos: [] });
      }
      loteEscolhido = null;
    }
    revisao(d);
  });
  solta.addEventListener('dragover', (e) => { e.preventDefault(); solta.classList.add('arrastando'); });
  solta.addEventListener('dragleave', () => solta.classList.remove('arrastando'));
  solta.addEventListener('drop', (e) => { e.preventDefault(); solta.classList.remove('arrastando'); ler(e.dataTransfer.files[0]); });
  $('#x-arquivo').addEventListener('change', (e) => { ler(e.target.files[0]); e.target.value = ''; });

  function revisao(d) {
    const conveniosXml = estado.convenios.filter((c) => c.tem_xml || c.id === d.convenioId);
    const escolher = d.candidatos.length > 1;
    const cand = (l) => `${esc(l.numero_lote)} · ${esc(l.convenio)}${l.valor_total == null ? '' : ` · ${num(l.qtd_guias)} guias · ${moeda(l.valor_total)}`} · ${esc(l.faturista)} · ${dataBR(l.data_lancamento)}`;
    $('#x-revisao').innerHTML = `<form style="margin-top:18px">
      ${d.avisos.length ? `<div class="avisos">${d.avisos.map(esc).join('<br>')}</div>` : ''}
      ${d.loteId && !escolher ? `<div class="avisos ok">Amarrado ao lote <b>${cand(d.candidatos.find((c) => c.id === d.loteId) || d.candidatos[0])}</b></div>` : ''}
      ${escolher ? `<div class="campo"><label>Mais de um lote combina. Qual é?</label>${d.candidatos.map((l, i) =>
        `<label class="opcao"><input type="radio" name="loteId" value="${l.id}" ${i === 0 ? 'checked' : ''}> ${cand(l)}</label>`).join('')}</div>` : ''}
      <div class="grade">
        <div class="campo"><label>Nº do lote</label><input name="numeroLote" value="${esc(d.numeroLote)}" ${escolher ? 'disabled' : 'required'}></div>
        <div class="campo"><label>Convênio</label><select name="convenioId" ${escolher ? 'disabled' : 'required'}><option value="">Selecione…</option>
          ${conveniosXml.map((c) => `<option value="${c.id}" ${c.id === d.convenioId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Data do envio</label><input name="dataEnvio" type="date" value="${hoje()}" required></div>
        <div class="campo"><label>Protocolo do portal (opcional)</label><input name="protocolo" value="${esc(d.protocolo)}"></div>
        <div class="campo"><label>Valor no protocolo do convênio (R$)</label><input name="valorProtocolo" inputmode="decimal" value="${d.valorProtocolo != null ? valorBR(d.valorProtocolo) : ''}" placeholder="0,00">
          <div class="guias-regra">Se for diferente do valor lançado, o faturista é avisado para corrigir.</div></div>
        ${todos ? `<div class="campo"><label>Quem enviou</label><select name="responsavelId">${opcoesFaturista(estado.usuario.id, false)}</select></div>` : ''}
      </div>
      <div class="campo"><label>Observação</label><textarea name="observacao" rows="2"></textarea></div>
      ${d.nomeArquivo ? `<p class="apagado" style="margin:0 0 12px">Arquivo: ${esc(d.nomeArquivo)}${d.tipo === 'ocr' ? ' · lido por OCR' : ''}</p>` : ''}
      <div class="acoes"><button type="button" class="btn btn-claro" data-cancelar>Cancelar</button><button class="btn btn-primario">Registrar envio</button></div></form>`;
    $('#x-revisao [data-cancelar]').addEventListener('click', () => { $('#x-revisao').innerHTML = ''; });
    $('#x-revisao form').addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      // Se a pessoa mudou o número ou o convênio, o servidor procura o lote de novo
      const mesmoLote = !escolher && v.numeroLote === d.numeroLote && Number(v.convenioId) === d.convenioId;
      const corpo = { ...v, arquivoId: d.arquivoId, nomeArquivo: d.nomeArquivo, loteId: escolher ? v.loteId : mesmoLote ? d.loteId : null };
      const r = await api('/api/xml', { method: 'POST', corpo });
      if (r.divergente) avisar(`Valor diferente do lançado no lote ${r.numeroLote}. ${r.faturista} foi avisado(a) para corrigir.`, true);
      else avisar(r.amarrado ? `XML do lote ${r.numeroLote} registrado e amarrado.` : `XML registrado. Vai amarrar quando o lote ${r.numeroLote} for lançado.`);
      recarregar();
    }));
    $('#x-revisao').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#x-pend').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const l = pendentes.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-anexar]')) { loteEscolhido = l; $('#x-arquivo').click(); }
    if (e.target.closest('[data-marcar]')) {
      revisao({ loteId: l.id, numeroLote: l.numero_lote, convenioId: l.convenio_id, candidatos: [l], avisos: [], protocolo: '', arquivoId: null, nomeArquivo: '' });
    }
  });
  $('#x-envios').addEventListener('click', tentar(async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const env = envios.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-excluir]')) {
      if (!confirm(`Excluir o registro de XML do lote ${env.numero_lote}?`)) return;
      await api(`/api/xml/${env.id}`, { method: 'DELETE' });
      avisar('Envio excluído.'); recarregar();
    }
    if (e.target.closest('[data-editar]')) {
      modal(`<h2>Editar envio do lote ${esc(env.numero_lote)}</h2><form><div class="grade">
        <div class="campo"><label>Nº do lote</label><input name="numeroLote" value="${esc(env.numero_lote)}" required></div>
        <div class="campo"><label>Convênio</label><select name="convenioId">${opcoesConvenio(env.convenio_id, false)}</select></div>
        <div class="campo"><label>Data do envio</label><input name="dataEnvio" type="date" value="${env.data_envio}" required></div>
        <div class="campo"><label>Protocolo do portal</label><input name="protocolo" value="${esc(env.protocolo)}"></div>
        <div class="campo"><label>Valor no protocolo (R$)</label><input name="valorProtocolo" inputmode="decimal" value="${env.valor_protocolo != null ? valorBR(env.valor_protocolo) : ''}"></div></div>
        <div class="campo"><label>Observação</label><textarea name="observacao" rows="2">${esc(env.observacao)}</textarea></div>
        <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`,
      (el, fechar) => $('form', el).addEventListener('submit', tentar(async (ev) => {
        ev.preventDefault();
        const r = await api(`/api/xml/${env.id}`, { method: 'PUT', corpo: Object.fromEntries(new FormData(ev.target)) });
        fechar(); avisar(r.amarrado ? 'Envio salvo e amarrado ao lote.' : 'Envio salvo. Ainda esperando o lote.'); recarregar();
      })));
    }
  }));
  carregarPendentes();
  carregarEnvios();
}

// ---------- Aba: Calendário de entregas ----------
// Quais convênios entregar em cada dia. A pessoa marca como entregue o que é dela;
// a coordenação monta o mês (adiciona, tira, marca feriado).
const REGRAS_CALENDARIO = [
  'Entregar os protocolos com as guias na ORDEM do relatório (alfabética ou por data de atendimento).',
  'Entregar as faturas pelo menos 1 dia antes da data de envio, conforme o calendário.',
  'Sempre conferir o VALOR do protocolo impresso com o do sistema (Tasy): os dois precisam estar iguais.',
  'Protocolo com erro: corrigir as guias. Nunca tirar guias do protocolo sem arrumá-las.',
  'Não deixar protocolo em provisório; se for o caso, pedir a exclusão. Facilita o fechamento.',
];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const estadoCal = { mes: '', filtro: '', pessoa: '' };

async function telaCalendario() {
  const s = estadoCal;
  const coord = estado.usuario.abas.includes('gestao'); // supervisão e coordenação montam o calendário
  if (!s.mes) s.mes = hoje().slice(0, 7);
  if (!s.filtro) s.filtro = veTodos() ? 'todos' : 'meus';
  const [cal, prox] = await Promise.all([api(`/api/calendario?mes=${s.mes}`), api('/api/calendario/proximos')]);
  const [ano, mes] = s.mes.split('-').map(Number);

  const visivel = (e) => {
    if (s.pessoa) return e.faturista_id === Number(s.pessoa) || e.xml_id === Number(s.pessoa);
    return s.filtro === 'meus' ? e.meu : true;
  };
  const porDia = {};
  for (const e of cal.entregas) (porDia[e.data] ||= []).push(e);
  const feriados = Object.fromEntries(cal.feriados.map((f) => [f.data, f.descricao]));

  const linhaEntrega = (e, comData = false) => `<div class="entrega ${e.meu ? 'minha' : ''} ${e.concluido ? 'feita' : ''}" data-id="${e.id}"
      title="${esc(`Fatura: ${e.faturista || '—'} · XML: ${e.tem_xml ? e.responsavel_xml || '—' : 'sem XML'}${e.concluido ? ` · entregue por ${e.concluido_por}` : ''}`)}">
      ${e.pode_concluir ? `<input type="checkbox" data-concluir ${e.concluido ? 'checked' : ''} aria-label="Marcar ${esc(e.convenio)} como entregue">` : '<span class="ponto"></span>'}
      <span class="nome">${esc(e.convenio)}${e.observacao ? ` <small>${esc(e.observacao)}</small>` : ''}${comData ? ` <small>· ${esc(e.faturista || 'sem faturista')}</small>` : ''}</span>
      ${coord ? '<button class="tirar" data-tirar title="Tirar do calendário">×</button>' : ''}</div>`;

  // Grade do mês
  const primeiro = new Date(ano, mes - 1, 1);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const celulas = [];
  for (let i = 0; i < primeiro.getDay(); i++) celulas.push('<div class="dia vazio"></div>');
  for (let d = 1; d <= diasNoMes; d++) {
    const iso = `${s.mes}-${String(d).padStart(2, '0')}`;
    const todas = porDia[iso] || [];
    const mostrar = todas.filter(visivel);
    const ocultas = todas.length - mostrar.length;
    const semana = new Date(ano, mes - 1, d).getDay();
    celulas.push(`<div class="dia ${iso === cal.hoje ? 'hoje' : ''} ${semana === 0 || semana === 6 ? 'fds' : ''} ${feriados[iso] ? 'feriado' : ''} ${todas.length ? '' : 'sem'}" data-dia="${iso}">
      <div class="dia-topo"><b>${d}</b><span class="dsem">${DIAS_SEMANA[semana]}</span>${feriados[iso] ? `<span class="selo devolvido">${esc(feriados[iso])}</span>` : ''}
        ${coord ? '<button class="mais" data-adicionar title="Adicionar convênio neste dia">+</button>' : ''}</div>
      ${mostrar.map((e) => linhaEntrega(e)).join('')}
      ${ocultas ? `<small class="apagado">+${ocultas} de outras pessoas</small>` : ''}</div>`);
  }

  // Próximas entregas (hoje e os próximos dias com entrega)
  const proxDias = [...new Set(prox.entregas.map((e) => e.data))];
  const amanhaIso = isoLocal(new Date(Date.now() + 864e5));
  const rotuloDia = (iso) => {
    const dt = new Date(`${iso}T12:00:00`);
    const base = `${DIAS_SEMANA[dt.getDay()]} ${dataBR(iso).slice(0, 5)}`;
    return iso === prox.hoje ? `Hoje · ${base}` : iso === amanhaIso ? `Amanhã · ${base}` : base;
  };
  const proxHtml = proxDias.map((iso) => {
    const lista = prox.entregas.filter((e) => e.data === iso).filter(visivel);
    if (!lista.length) return '';
    const feitas = lista.filter((e) => e.concluido).length;
    return `<div class="prox-dia"><h3>${rotuloDia(iso)} <small>${feitas}/${lista.length} entregues</small></h3>${lista.map((e) => linhaEntrega(e, true)).join('')}</div>`;
  }).join('') || '<div class="apagado">Nada para entregar nos próximos dias.</div>';

  const portais = estado.convenios.filter((c) => c.ativo && c.prazo_texto && (s.filtro !== 'meus' || c.faturista_id === estado.usuario.id || c.xml_id === estado.usuario.id));
  const mesAnt = new Date(ano, mes - 2, 1);
  const mesProx = new Date(ano, mes, 1);
  const ym = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  const totalVisiveis = cal.entregas.filter(visivel);

  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Calendário de entregas</h1><p>Quais convênios entregar em cada dia. Entregue a fatura ao setor pelo menos 1 dia antes.</p></div>
      <div class="acoes">
        <div class="alternar"><button data-filtro="meus" class="${s.filtro === 'meus' && !s.pessoa ? 'ativo' : ''}">Meus convênios</button><button data-filtro="todos" class="${s.filtro === 'todos' && !s.pessoa ? 'ativo' : ''}">Todos</button></div>
        ${veTodos() ? `<select id="cal-pessoa" style="width:auto">${opcoesPessoa(s.pessoa, 'Filtrar por pessoa')}</select>` : ''}
        <button class="btn btn-claro" onclick="print()">Imprimir</button>
      </div></div>
    <div class="cartao"><h2>Próximas entregas <small class="apagado">marque quando entregar</small></h2><div class="prox">${proxHtml}</div></div>
    <div class="cartao">
      <h2><span class="mes-nav"><button class="btn btn-claro btn-mini" data-mes="${ym(mesAnt)}">‹</button>
        <span>${NOMES_MES[mes - 1][0].toUpperCase() + NOMES_MES[mes - 1].slice(1)} de ${ano}</span><button class="btn btn-claro btn-mini" data-mes="${ym(mesProx)}">›</button>
        ${s.mes !== hoje().slice(0, 7) ? `<button class="btn btn-claro btn-mini" data-mes="${hoje().slice(0, 7)}">Hoje</button>` : ''}</span>
        <small class="apagado">${totalVisiveis.filter((e) => e.concluido).length}/${totalVisiveis.length} entregues no mês</small></h2>
      ${cal.entregas.length || cal.feriados.length ? '' : `<div class="avisos">Este mês ainda não tem calendário.${coord ? ' Use o + em cada dia para montar.' : ' A coordenação ainda vai montar.'}</div>`}
      <div class="cal-cabeca">${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grade">${celulas.join('')}</div>
      <p class="apagado legenda"><span class="entrega minha exemplo"><span class="ponto"></span><span class="nome">Seu convênio</span></span>
        <span class="entrega exemplo"><span class="ponto"></span><span class="nome">De outra pessoa</span></span> Passe o mouse para ver quem fatura e quem passa o XML.</p>
    </div>
    <div class="duas">
      <div class="cartao"><h2>Portais fixos <small class="apagado">${coord ? 'clique num convênio para mudar o prazo' : 'prazo de cada portal no mês'}</small></h2>
        <div class="chips">${portais.map((c) => `<${coord ? 'button type="button"' : 'span'} class="chip ${c.aberto_hoje ? 'aberto' : ''} ${coord ? 'editavel' : ''}" data-prazo-conv="${c.id}"><b>${esc(c.nome)}</b><small>${esc(c.prazo_texto)}${c.aberto_hoje ? ' · aberto hoje' : ''}</small></${coord ? 'button' : 'span'}>`).join('') || '<span class="apagado">Nenhum.</span>'}</div>
        ${coord ? `<div class="campo" style="margin:14px 0 0;max-width:320px"><label>Definir prazo de outro convênio</label>
          <select id="prazo-outro"><option value="">Escolha…</option>${estado.convenios.filter((c) => c.ativo && !c.prazo_texto).map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>` : ''}</div>
      <div class="cartao"><h2>Regras do calendário</h2><ol class="regras">${REGRAS_CALENDARIO.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div>
    </div>`;

  // Navegação e filtros
  $('#conteudo').onclick = tentar(async (e) => {
    const alvo = e.target;
    if (alvo.closest('[data-mes]')) { s.mes = alvo.closest('[data-mes]').dataset.mes; return telaCalendario(); }
    if (alvo.closest('[data-filtro]')) { s.filtro = alvo.closest('[data-filtro]').dataset.filtro; s.pessoa = ''; return telaCalendario(); }
    const linha = alvo.closest('.entrega[data-id]');
    if (alvo.closest('[data-tirar]') && linha) {
      const ent = cal.entregas.find((x) => x.id === Number(linha.dataset.id)) || prox.entregas.find((x) => x.id === Number(linha.dataset.id));
      if (!confirm(`Tirar ${ent.convenio} do dia ${dataBR(ent.data)}?`)) return;
      await api(`/api/calendario/${ent.id}`, { method: 'DELETE' });
      return telaCalendario();
    }
    if (alvo.closest('[data-adicionar]')) adicionarNoDia(alvo.closest('[data-dia]').dataset.dia, feriados);
    const chip = alvo.closest('[data-prazo-conv]');
    if (chip && coord) editarPrazo(estado.convenios.find((c) => c.id === Number(chip.dataset.prazoConv)), telaCalendario);
  });
  $('#conteudo').onchange = tentar(async (e) => {
    if (e.target.id === 'cal-pessoa') { s.pessoa = e.target.value; return telaCalendario(); }
    if (e.target.id === 'prazo-outro' && e.target.value) return editarPrazo(estado.convenios.find((c) => c.id === Number(e.target.value)), telaCalendario);
    const caixa = e.target.closest('[data-concluir]');
    if (!caixa) return;
    const id = Number(caixa.closest('.entrega').dataset.id);
    try {
      const r = await api(`/api/calendario/${id}`, { method: 'PATCH', corpo: { concluido: caixa.checked } });
      avisar(r.concluido ? `${r.convenio}: entregue.` : `${r.convenio}: desmarcado.`);
    } finally { telaCalendario(); carregarAlertas(); }
  });
}

// Prazo do portal: "de X a Y", "dias X e Y", "até o Nº dia útil" ou texto livre.
// Supervisão e coordenação podem mudar.
function editarPrazo(c, depois) {
  const t = c.prazo_tipo && c.prazo_texto ? c.prazo_tipo : 'intervalo';
  const opcao = (v, rotulo) => `<label class="opcao"><input type="radio" name="tipo" value="${v}" ${t === v ? 'checked' : ''}> ${rotulo}</label>`;
  modal(`<h2>Prazo do portal · ${esc(c.nome)}</h2><form class="form-prazo">
    ${opcao('intervalo', 'De um dia a outro <small class="apagado">ex.: de 1 a 7</small>')}
    <div class="sub" data-para="intervalo">De <input name="inicio" type="number" min="1" max="31" value="${c.prazo_inicio ?? ''}"> a <input name="fim" type="number" min="1" max="31" value="${c.prazo_fim ?? ''}"></div>
    ${opcao('dias', 'Dias específicos <small class="apagado">ex.: 9 e 27</small>')}
    <div class="sub" data-para="dias">Dias <input name="dias" placeholder="9 e 27" value="${(c.prazo_dias || []).join(' e ')}" style="width:160px"></div>
    ${opcao('dia_util', 'Até o Nº dia útil <small class="apagado">ex.: até o 5º dia útil (desconta os feriados do calendário)</small>')}
    <div class="sub" data-para="dia_util">Até o <input name="dia_util" type="number" min="1" max="23" value="${c.prazo_dia_util ?? ''}">º dia útil</div>
    ${opcao('livre', 'Outro <small class="apagado">texto livre, ex.: diário até as 17h</small>')}
    <div class="sub" data-para="livre"><input name="livre" value="${c.prazo_tipo === 'livre' ? esc(c.prazo_texto) : ''}" style="width:100%"></div>
    <div class="campo" data-hora style="margin-top:10px;max-width:200px"><label>Até que horas? (opcional)</label><input name="hora" placeholder="17h" value="${esc(c.prazo_hora || '')}"></div>
    <p class="apagado" id="previa" style="margin:6px 0 0"></p>
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar prazo</button></div></form>`,
  (el, fechar) => {
    const form = $('form', el);
    const atualizar = () => {
      const tipo = form.tipo.value;
      $$('.sub', el).forEach((d) => d.classList.toggle('oculto', d.dataset.para !== tipo));
      $('[data-hora]', el).classList.toggle('oculto', tipo === 'livre');
      const dias = [...new Set((form.dias.value.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b);
      const base = tipo === 'intervalo' ? (form.inicio.value && form.fim.value ? `${form.inicio.value} a ${form.fim.value}` : '')
        : tipo === 'dias' ? (dias.length > 1 ? `${dias.slice(0, -1).join(', ')} e ${dias.at(-1)}` : dias.join(''))
        : tipo === 'dia_util' ? (form.dia_util.value ? `até o ${form.dia_util.value}º dia útil` : '') : form.livre.value;
      $('#previa', el).textContent = base ? `Vai aparecer: ${base}${tipo !== 'livre' && form.hora.value ? `, até as ${form.hora.value}` : ''}` : '';
    };
    form.addEventListener('input', atualizar);
    atualizar();
    form.addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const prazo = Object.fromEntries(new FormData(form));
      const novo = await api(`/api/convenios/${c.id}`, { method: 'PUT', corpo: { prazo } });
      estado.convenios = estado.convenios.map((x) => (x.id === c.id ? novo : x));
      fechar(); avisar(`${novo.nome}: ${novo.prazo_texto}.`); depois();
    }));
  });
}

// Coordenação: adicionar convênio num dia, ou marcar o dia como feriado
function adicionarNoDia(dia, feriados) {
  modal(`<h2>${dataBR(dia)}</h2><form>
    <div class="grade">
      <div class="campo"><label>Convênio</label><select name="convenioId"><option value="">Escolha…</option>${opcoesConvenio('', false)}</select></div>
      <div class="campo"><label>…ou um convênio novo</label><input name="convenioNome" placeholder="Nome"></div>
      <div class="campo"><label>Observação</label><input name="observacao" placeholder="ex.: até as 10h"></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:4px"><input type="checkbox" name="feriado" style="width:auto" ${feriados[dia] ? 'checked' : ''}>
      Este dia é feriado <input name="descricao" placeholder="Descrição" value="${esc(feriados[dia] || '')}" style="max-width:200px;margin-left:8px"></label>
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`,
  (el, fechar) => $('form', el).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!!f.feriado !== !!feriados[dia] || (f.feriado && f.descricao !== feriados[dia])) {
      await api('/api/calendario/feriado', { method: 'POST', corpo: { data: dia, feriado: !!f.feriado, descricao: f.descricao || 'Feriado' } });
    }
    if (f.convenioId || f.convenioNome.trim()) {
      await api('/api/calendario', { method: 'POST', corpo: { data: dia, convenioId: f.convenioId || null, convenioNome: f.convenioNome, observacao: f.observacao } });
      await carregarListas();
    }
    fechar(); avisar('Calendário atualizado.'); telaCalendario();
  })));
}

// ---------- Aba: Convênios ----------
// "Meus convênios": o que a pessoa fatura e o que ela passa de XML, com prazo e parceiro.
// "Todos os convênios": a lista completa, só para consulta (quem muda é a coordenação).
const estadoConv = { sub: '', busca: '', pessoa: '', xml: '' };

function telaConvenios() {
  const eu = estado.usuario;
  const s = estadoConv;
  const fatura = estado.convenios.filter((c) => c.ativo && c.faturista_id === eu.id);
  const passaXml = estado.convenios.filter((c) => c.ativo && c.xml_id === eu.id);
  if (!s.sub) s.sub = fatura.length || passaXml.length ? 'meus' : 'todos';
  const ordenar = (l) => [...l].sort((a, b) => b.aberto_hoje - a.aberto_hoje || a.nome.localeCompare(b.nome));
  const ninguem = '<span class="apagado">—</span>';
  const xmlSelo = (c) => (c.tem_xml ? '<span class="selo xml-enviado">Tem XML</span>' : '<span class="selo xml-na">Sem XML</span>');

  const tabelaMeus = (lista, parceiro) => (!lista.length ? '<div class="vazio">Nenhum convênio.</div>' : `<div class="tabela-caixa"><table>
    <thead><tr><th>Convênio</th><th>Prazo do portal</th><th>XML</th><th>${parceiro === 'xml' ? 'Quem passa o XML' : 'Quem fatura'}</th></tr></thead>
    <tbody>${ordenar(lista).map((c) => `<tr><td><b>${esc(c.nome)}</b></td><td>${prazo(c)}</td><td>${xmlSelo(c)}</td>
      <td>${parceiro === 'xml' ? (c.tem_xml ? (c.responsavel_xml ? esc(c.responsavel_xml) : ninguem) : ninguem) : (c.faturista ? esc(c.faturista) : ninguem)}</td></tr>`).join('')}</tbody></table></div>`);

  let corpo;
  if (s.sub === 'meus') {
    const abertos = [...new Set([...fatura, ...passaXml])].filter((c) => c.aberto_hoje);
    corpo = `
      <div class="kpis">
        ${fatura.length || eu.funcao !== 'xml' ? `<div class="kpi"><span>Convênios que eu faturo</span><b>${fatura.length}</b></div>` : ''}
        ${passaXml.length || eu.funcao !== 'faturamento' ? `<div class="kpi"><span>Em que passo o XML</span><b>${passaXml.length}</b></div>` : ''}
        <div class="kpi ${abertos.length ? 'destaque' : ''}"><span>Portais abertos hoje</span><b>${abertos.length}</b><small>${abertos.map((c) => esc(c.nome)).join(', ') || 'nenhum'}</small></div>
      </div>
      ${eu.perfil !== 'faturista' || fatura.length || eu.funcao !== 'xml' ? `<div class="cartao"><h2>Convênios que eu faturo</h2>${tabelaMeus(fatura, 'xml')}</div>` : ''}
      ${eu.perfil !== 'faturista' || passaXml.length || eu.funcao !== 'faturamento' ? `<div class="cartao"><h2>Convênios em que passo o XML</h2>${tabelaMeus(passaXml, 'fatura')}</div>` : ''}
      <p class="apagado" style="font-size:12px">A divisão é feita pela coordenação. Se algum convênio estiver faltando ou sobrando, fale com ela.</p>`;
  } else {
    const termo = s.busca.trim().toLowerCase();
    const lista = estado.convenios.filter((c) => c.ativo
      && (!termo || c.nome.toLowerCase().includes(termo))
      && (!s.pessoa || c.faturista_id === Number(s.pessoa) || c.xml_id === Number(s.pessoa))
      && (!s.xml || String(Number(c.tem_xml)) === s.xml));
    corpo = `<div class="cartao">
      <div class="filtros">
        <div class="campo"><label>Buscar</label><input id="cv-busca" value="${esc(s.busca)}" placeholder="Nome do convênio"></div>
        <div class="campo"><label>Pessoa</label><select id="cv-pessoa">${opcoesPessoa(s.pessoa, 'Todas')}</select></div>
        <div class="campo"><label>XML</label><select id="cv-xml"><option value="">Todos</option>
          <option value="1" ${s.xml === '1' ? 'selected' : ''}>Com XML</option><option value="0" ${s.xml === '0' ? 'selected' : ''}>Sem XML</option></select></div>
      </div>
      <p class="apagado" style="margin:-4px 0 12px;font-size:12px">${lista.length} convênio(s) · os seus aparecem destacados</p>
      <div class="tabela-caixa"><table>
        <thead><tr><th>Convênio</th><th>Quem fatura</th><th>Quem passa o XML</th><th>XML</th><th>Prazo do portal</th></tr></thead>
        <tbody>${lista.map((c) => `<tr class="${c.faturista_id === eu.id || c.xml_id === eu.id ? 'linha-minha' : ''}"><td><b>${esc(c.nome)}</b></td>
          <td>${c.faturista ? esc(c.faturista) : ninguem}</td><td>${c.tem_xml ? (c.responsavel_xml ? esc(c.responsavel_xml) : ninguem) : ninguem}</td>
          <td>${xmlSelo(c)}</td><td>${prazo(c)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum convênio nesse filtro.</td></tr>'}</tbody></table></div></div>`;
  }

  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Convênios</h1><p>Os convênios de cada pessoa, segundo a divisão da coordenação, e a lista completa.</p></div></div>
    <div class="subabas">${[['meus', 'Meus convênios'], ['todos', 'Todos os convênios']].map(([k, v]) => `<button data-sub="${k}" class="${s.sub === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    ${corpo}`;
  $('.subabas').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) { s.sub = b.dataset.sub; telaConvenios(); } });
  $('#cv-busca')?.addEventListener('input', (e) => { s.busca = e.target.value; const pos = e.target.selectionStart; telaConvenios(); const i = $('#cv-busca'); i.focus(); i.setSelectionRange(pos, pos); });
  $('#cv-pessoa')?.addEventListener('change', (e) => { s.pessoa = e.target.value; telaConvenios(); });
  $('#cv-xml')?.addEventListener('change', (e) => { s.xml = e.target.value; telaConvenios(); });
}

// ---------- Aba: Gestão ----------
let subGestao = 'lotes';
async function telaGestao() {
  $('#conteudo').innerHTML = `
    <div class="topo"><div><h1>Gestão</h1><p>Conferência dos lotes da equipe e cadastros.</p></div></div>
    <div class="subabas">${[['lotes', 'Lotes da equipe'], ['usuarios', 'Usuários']]
      .map(([k, v]) => `<button data-sub="${k}" class="${subGestao === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>
    <div id="sub"></div>`;
  $('.subabas').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) { subGestao = b.dataset.sub; telaGestao(); } });
  await ({ lotes: gestaoLotes, usuarios: gestaoUsuarios }[subGestao] || gestaoLotes)();
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
      <div class="campo"><label>XML</label><select id="g-xml"><option value="">Todos</option>${Object.entries(XML).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="campo"><label>Buscar lote</label><input id="g-busca" placeholder="Nº do lote"></div>
    </div>
    <div id="g-lista"></div></div>`;
  let lotes = [];
  const carregar = tentar(async () => {
    lotes = await api(`/api/lotes?${qs({ faturista: $('#g-fat').value, convenio: $('#g-conv').value, competencia: $('#g-comp').value, status: $('#g-status').value, xml: $('#g-xml').value, inicio: $('#g-ini').value, fim: $('#g-fim').value, busca: $('#g-busca').value })}`);
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
    <div class="tabela-caixa"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Função</th><th>Situação</th><th>Criado em</th><th></th></tr></thead>
    <tbody>${usuarios.map((u) => `<tr data-id="${u.id}"><td><b>${esc(u.nome)}</b></td><td>${esc(u.login)}</td><td>${PERFIS[u.perfil]}</td><td>${u.perfil === 'faturista' ? FUNCOES[u.funcao] : '—'}</td>
      <td><span class="selo ${u.ativo ? 'conferido' : 'devolvido'}">${u.ativo ? 'Ativo' : 'Inativo'}</span>${u.trocar_senha ? ' <span class="selo lancado" title="Ainda não criou a própria senha">senha inicial</span>' : ''}</td><td>${dataBR(u.criado_em.slice(0, 10))}</td>
      <td><div class="acoes">${perfis.includes(u.perfil) ? '<button class="btn btn-claro btn-mini" data-editar>Editar</button>' : ''}</div></td></tr>`).join('')}</tbody></table></div></div>`;

  const form = (u = {}) => `<form>
    <div class="grade">
      <div class="campo"><label>Nome</label><input name="nome" value="${esc(u.nome)}" required></div>
      <div class="campo"><label>Login</label><input name="login" value="${esc(u.login)}" ${u.id ? 'disabled' : 'required'}></div>
      <div class="campo"><label>Perfil</label><select name="perfil">${perfis.map((p) => `<option value="${p}" ${u.perfil === p ? 'selected' : ''}>${PERFIS[p]}</option>`).join('')}</select></div>
      <div class="campo"><label>Função (equipe)</label><select name="funcao">${Object.entries(FUNCOES).map(([k, v]) => `<option value="${k}" ${(u.funcao || 'ambos') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>

    </div>
    ${u.id ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ativo" style="width:auto" ${u.ativo ? 'checked' : ''}> Usuário ativo</label>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" name="redefinir" style="width:auto"> Redefinir a senha para a inicial (a pessoa cria outra no próximo acesso)</label>`
      : '<p class="apagado" style="margin:0">A pessoa entra com a senha inicial e cria a dela no primeiro acesso.</p>'}
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
        await api(`/api/usuarios/${u.id}`, { method: 'PUT', corpo: { ...f, ativo: !!f.ativo, redefinir: !!f.redefinir } });
        fechar(); avisar('Usuário atualizado.'); await carregarListas(); gestaoUsuarios();
      }));
    });
  });
}

// ---------- Coordenação: convênios e responsáveis ----------
// A coordenação define, por convênio: tem XML (sim/não), quem fatura, quem passa o XML e o prazo do portal.
// Cada mudança salva na hora.
const filtroDist = { busca: '', pessoa: '', xml: '', faltando: '' };

async function coordConvenios(caixa) {
  await carregarListas();
  const f = filtroDist;
  const lista = estado.convenios.filter((c) => {
    if (f.busca && !c.nome.toLowerCase().includes(f.busca.toLowerCase())) return false;
    if (f.pessoa && c.faturista_id !== Number(f.pessoa) && c.xml_id !== Number(f.pessoa)) return false;
    if (f.xml && String(Number(c.tem_xml)) !== f.xml) return false;
    if (f.faltando === 'faturista' && c.faturista_id) return false;
    if (f.faltando === 'xml' && (c.xml_id || !c.tem_xml)) return false;
    return true;
  });
  const ativos = estado.convenios.filter((c) => c.ativo);
  const semFat = ativos.filter((c) => !c.faturista_id).length;
  const semXml = ativos.filter((c) => c.tem_xml && !c.xml_id).length;
  const semXmlConv = ativos.filter((c) => !c.tem_xml).length;
  caixa.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Convênios ativos</span><b>${num(ativos.length)}</b><small>${num(semXmlConv)} sem XML</small></div>
      <div class="kpi"><span>Sem quem fature</span><b class="${semFat ? 'desce' : ''}">${num(semFat)}</b></div>
      <div class="kpi"><span>Sem quem passe o XML</span><b class="${semXml ? 'desce' : ''}">${num(semXml)}</b></div>
    </div>
    <div class="cartao">
      <h2>Convênios e responsáveis <button class="btn btn-primario btn-mini" id="novo-conv">Novo convênio</button></h2>
      <div class="filtros">
        <div class="campo"><label>Buscar</label><input id="d-busca" value="${esc(f.busca)}" placeholder="Nome do convênio"></div>
        <div class="campo"><label>Pessoa</label><select id="d-pessoa">${opcoesPessoa(f.pessoa, 'Todas')}</select></div>
        <div class="campo"><label>XML</label><select id="d-xml"><option value="">Todos</option>
          <option value="1" ${f.xml === '1' ? 'selected' : ''}>Com XML</option><option value="0" ${f.xml === '0' ? 'selected' : ''}>Sem XML</option></select></div>
        <div class="campo"><label>Mostrar</label><select id="d-faltando"><option value="">Todos</option>
          <option value="faturista" ${f.faltando === 'faturista' ? 'selected' : ''}>Sem quem fature</option>
          <option value="xml" ${f.faltando === 'xml' ? 'selected' : ''}>Sem quem passe XML</option></select></div>
      </div>
      <div class="tabela-caixa"><table class="editavel">
        <thead><tr><th>Convênio</th><th>Tem XML?</th><th>Quem fatura</th><th>Quem passa o XML</th><th>Prazo do portal</th><th>Ativo</th><th></th></tr></thead>
        <tbody>${lista.map((c) => `<tr data-id="${c.id}" class="${c.ativo ? '' : 'inativo'}">
          <td><b>${esc(c.nome)}</b>${c.codigo ? `<br><small class="apagado">${esc(c.codigo)}</small>` : ''}</td>
          <td><label class="interruptor"><input type="checkbox" data-campo="tem_xml" ${c.tem_xml ? 'checked' : ''}><span>${c.tem_xml ? 'Sim' : 'Não'}</span></label></td>
          <td><select data-campo="faturista_id" class="${c.faturista_id ? '' : 'falta'}">${opcoesPessoa(c.faturista_id, '— ninguém —', 'fatura')}</select></td>
          <td><select data-campo="xml_id" class="${c.xml_id || !c.tem_xml ? '' : 'falta'}" ${c.tem_xml ? '' : 'disabled'}>${opcoesPessoa(c.xml_id, c.tem_xml ? '— ninguém —' : 'não tem XML', 'xml')}</select></td>
          <td class="prazo-cel">${prazo(c)} <button class="btn btn-claro btn-mini" data-prazo>Editar</button></td>
          <td><input type="checkbox" data-campo="ativo" ${c.ativo ? 'checked' : ''} style="width:auto"></td>
          <td><div class="acoes"><button class="btn btn-claro btn-mini" data-editar>Renomear</button><button class="btn btn-perigo btn-mini" data-excluir>Excluir</button></div></td>
        </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum convênio nesse filtro.</td></tr>'}</tbody></table></div>
      <p class="apagado" style="font-size:12px;margin:12px 0 0">Cada mudança salva na hora. Convênios novos que aparecem nos PDFs entram sozinhos (com XML, sem responsáveis).</p>
    </div>`;

  const redesenhar = () => coordConvenios(caixa);
  $('#d-busca').addEventListener('change', (e) => { f.busca = e.target.value; redesenhar(); });
  $('#d-pessoa').addEventListener('change', (e) => { f.pessoa = e.target.value; redesenhar(); });
  $('#d-xml').addEventListener('change', (e) => { f.xml = e.target.value; redesenhar(); });
  $('#d-faltando').addEventListener('change', (e) => { f.faltando = e.target.value; redesenhar(); });

  // Salva o campo que mudou
  $('tbody', caixa).addEventListener('change', tentar(async (e) => {
    const el = e.target.closest('[data-campo]');
    if (!el) return;
    const id = Number(el.closest('tr').dataset.id);
    const campo = el.dataset.campo;
    const valor = el.type === 'checkbox' ? el.checked : el.value;
    try {
      const novo = await api(`/api/convenios/${id}`, { method: 'PUT', corpo: { [campo]: valor } });
      estado.convenios = estado.convenios.map((c) => (c.id === id ? novo : c));
      avisar(`${novo.nome}: salvo.`);
      if (['tem_xml', 'ativo', 'faturista_id', 'xml_id'].includes(campo)) redesenhar();
    } catch (err) { redesenhar(); throw err; }
  }));

  const form = (c = {}) => `<form><div class="grade">
      <div class="campo"><label>Nome</label><input name="nome" value="${esc(c.nome)}" required></div>
      <div class="campo"><label>Código</label><input name="codigo" value="${esc(c.codigo)}"></div></div>
    <div class="rodape"><button type="button" class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-primario">Salvar</button></div></form>`;
  const salvar = (c) => (el, fechar) => $('form', el).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    await api(c ? `/api/convenios/${c.id}` : '/api/convenios', { method: c ? 'PUT' : 'POST', corpo: Object.fromEntries(new FormData(e.target)) });
    fechar(); avisar('Convênio salvo.'); redesenhar();
  }));
  $('#novo-conv').addEventListener('click', () => modal('<h2>Novo convênio</h2>' + form(), salvar(null)));
  $('tbody', caixa).addEventListener('click', tentar(async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const c = estado.convenios.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-prazo]')) return editarPrazo(c, redesenhar);
    if (e.target.closest('[data-editar]')) modal(`<h2>Renomear ${esc(c.nome)}</h2>${form(c)}`, salvar(c));
    if (e.target.closest('[data-excluir]') && confirm(`Excluir o convênio ${c.nome}?`)) {
      await api(`/api/convenios/${c.id}`, { method: 'DELETE' });
      avisar('Convênio excluído.'); redesenhar();
    }
  }));
}

// ---------- Coordenação: divisão da equipe (como a planilha) ----------
function coordDivisao(caixa) {
  const ativos = estado.convenios.filter((c) => c.ativo);
  const quadro = (titulo, campo, nomeCampo, filtro = () => true) => {
    const lista = ativos.filter(filtro);
    const pessoas = estado.faturistas.filter((p) => lista.some((c) => c[campo] === p.id));
    const sem = lista.filter((c) => !c[campo]);
    const coluna = (nome, itens, falta = false) => `<div class="coluna-div ${falta ? 'falta' : ''}"><h3>${esc(nome)} <small>${itens.length}</small></h3>
      <ul>${itens.map((c) => `<li>${esc(c.nome)}${c.prazo_texto ? `<small>${esc(c.prazo_texto)}</small>` : ''}</li>`).join('')}</ul></div>`;
    return `<div class="cartao"><h2>${titulo}</h2><div class="divisao">
      ${pessoas.map((p) => coluna(p.nome, lista.filter((c) => c[campo] === p.id))).join('')}
      ${sem.length ? coluna('Sem responsável', sem, true) : ''}</div></div>`;
  };
  const semXml = ativos.filter((c) => !c.tem_xml);
  caixa.innerHTML = `
    <div class="acoes" style="margin-bottom:14px"><button class="btn btn-claro" onclick="print()">Imprimir</button></div>
    ${quadro('Envio de XML — divisão de convênios', 'xml_id', 'responsavel_xml', (c) => c.tem_xml)}
    ${quadro('Faturamento — quem fatura cada convênio', 'faturista_id', 'faturista')}
    <div class="cartao"><h2>Convênios sem XML</h2>${semXml.length
      ? `<div class="chips">${semXml.map((c) => `<span class="chip"><b>${esc(c.nome)}</b></span>`).join('')}</div>`
      : '<div class="apagado">Todos os convênios ativos têm XML.</div>'}</div>`;
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

// A mesma tela serve duas abas: "Relatórios" (produção) e "Coordenação" (convênios e divisão da equipe)
let subCoord = 'convenios';
const SUBS_COORD = [['convenios', 'Convênios e responsáveis'], ['divisao', 'Divisão da equipe']];

async function telaCoordenacao() {
  const f = filtroCoord;
  const soProducao = estado.aba === 'producao';
  const sub = soProducao ? 'relatorios' : subCoord;
  const cabeca = `
    <div class="topo"><div><h1>${soProducao ? 'Relatórios' : 'Coordenação'}</h1><p>${soProducao ? 'Produção de cada faturista por dia, mês e ano, e relatórios por convênio, competência ou período.' : 'Quem fatura e quem passa o XML de cada convênio, e a divisão da equipe.'}</p></div>
      ${sub === 'relatorios' ? '<div class="acoes"><button class="btn btn-claro" id="csv">Exportar planilha (CSV)</button><button class="btn btn-claro" onclick="print()">Imprimir</button></div>' : ''}</div>
    <div class="subabas ${soProducao ? 'oculto' : ''}">${SUBS_COORD.map(([k, v]) => `<button data-sub="${k}" class="${subCoord === k ? 'ativa' : ''}">${v}</button>`).join('')}</div>`;
  const ligarSub = () => $('.subabas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (b) { subCoord = b.dataset.sub; telaCoordenacao(); }
  });
  if (sub !== 'relatorios') {
    $('#conteudo').innerHTML = `${cabeca}<div id="csub"></div>`;
    ligarSub();
    await carregarListas();
    return subCoord === 'convenios' ? coordConvenios($('#csub')) : coordDivisao($('#csub'));
  }
  $('#conteudo').innerHTML = `${cabeca}
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
  ligarSub();

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
  $('#csv').addEventListener('click', tentar(async () => {
    const r = await fetch(`/api/relatorios/csv?${qs(params())}`);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'faturale-relatorio.csv' });
    a.click();
  }));
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
      <div class="kpi"><span>Lotes sem XML enviado</span><b class="${p.xmlPendentes.lotes ? 'desce' : ''}">${num(p.xmlPendentes.lotes)}</b><small>${moeda(p.xmlPendentes.valor)}</small></div>
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
