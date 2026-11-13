// Faturale · demonstração estática (GitHub Pages).
// Simula a API do Django dentro do navegador: as telas são as mesmas do sistema.
// Os dados ficam só neste navegador (localStorage). Nada é enviado a lugar nenhum.
(() => {
  const CHAVE = 'faturale-demo-v5';
  const fetchOriginal = window.fetch.bind(window);
  let db = null;
  const arquivos = {}; // 'lote:ID' / 'xml:ID' -> object URL (só nesta sessão)
  const pendentes = {}; // token -> File

  // ---------- utilidades ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoje = () => iso(new Date());
  const addDias = (s, n) => { if (!s) return s; const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const erro = (m, s = 400) => json({ erro: m }, s);
  const novoId = (lista) => Math.max(0, ...lista.map((x) => x.id)) + 1;
  const ABAS = {
    faturista: ['faturamento', 'xml', 'minha', 'calendario', 'convenios'],
    supervisora: ['faturamento', 'xml', 'minha', 'calendario', 'convenios', 'gestao', 'producao'],
    coordenadora: ['faturamento', 'xml', 'minha', 'calendario', 'convenios', 'gestao', 'producao', 'coordenacao'],
    diretor: ['faturamento', 'xml', 'minha', 'calendario', 'convenios', 'gestao', 'producao', 'coordenacao', 'diretoria'],
  };
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch {} };

  // Traz as datas para perto de hoje, para os painéis do "mês atual" terem dados.
  function aproximarDatas(d) {
    const dias = Math.round((new Date(`${hoje()}T12:00:00`) - new Date(`${d.exportadoEm}T12:00:00`)) / 864e5);
    if (dias <= 0) return d;
    for (const l of d.lotes) {
      for (const k of ['data_lancamento', 'periodo_inicio', 'periodo_fim']) l[k] = addDias(l[k], dias);
      const dt = new Date(`${l.data_lancamento}T12:00:00`);
      l.competencia = iso(new Date(dt.getFullYear(), dt.getMonth() + 1, 1)).slice(0, 7);
    }
    for (const e of d.envios) e.data_envio = addDias(e.data_envio, dias);
    // Calendário: mesmo "n-ésimo dia da semana" no mês de hoje
    const [ay, am] = d.exportadoEm.split('-').map(Number);
    const agora = new Date();
    const meses = (agora.getFullYear() - ay) * 12 + (agora.getMonth() + 1 - am);
    if (meses > 0) {
      const mover = (s) => {
        const dt = new Date(`${s}T12:00:00`);
        const nth = Math.ceil(dt.getDate() / 7);
        const alvo = new Date(dt.getFullYear(), dt.getMonth() + meses, 1, 12);
        while (alvo.getDay() !== dt.getDay()) alvo.setDate(alvo.getDate() + 1);
        alvo.setDate(alvo.getDate() + (nth - 1) * 7);
        if (alvo.getMonth() !== (dt.getMonth() + meses) % 12) alvo.setDate(alvo.getDate() - 7);
        return iso(alvo);
      };
      for (const e of d.entregas) e.data = mover(e.data);
      for (const f of d.feriados) f.data = mover(f.data);
    }
    d.exportadoEm = hoje();
    return d;
  }

  const pronto = (async () => {
    try { db = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { db = null; }
    if (!db) {
      const r = await fetchOriginal('dados.json');
      db = aproximarDatas(await r.json());
      db.usuarioAtual = null;
      salvar();
    }
  })();

  // ---------- consultas ----------
  const eu = () => db.usuarios.find((u) => u.id === db.usuarioAtual && u.ativo);
  const veTodos = (u) => u.perfil !== 'faturista';
  const conv = (id) => db.convenios.find((c) => c.id === Number(id));
  const pessoa = (id) => db.usuarios.find((u) => u.id === Number(id));
  const nome = (id) => pessoa(id)?.nome || null;
  const temEnvio = (l) => db.envios.some((e) => e.lote_id === l.id);
  const xmlDe = (l) => (!conv(l.convenio_id).tem_xml ? 'na' : temEnvio(l) ? 'enviado' : 'pendente');
  // Prazo do portal: "de X a Y", "dias X e Y", "até o Nº dia útil" (desconta feriados) ou texto livre
  const diaUtil = (dt) => {
    const fer = new Set(db.feriados.map((f) => f.data));
    if (dt.getDay() % 6 === 0 || fer.has(iso(dt))) return 0;
    let n = 0;
    for (let d = new Date(dt.getFullYear(), dt.getMonth(), 1, 12); d <= dt; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 && !fer.has(iso(d))) n++;
    return n;
  };
  const abertoHoje = (c) => {
    const agora = new Date(); const dia = agora.getDate();
    if (c.prazo_tipo === 'dias') return (c.prazo_dias || []).includes(dia);
    if (c.prazo_tipo === 'dia_util') { const n = diaUtil(agora); return !!(c.prazo_dia_util && n > 0 && n <= c.prazo_dia_util); }
    if (c.prazo_tipo === 'intervalo') return !!(c.prazo_inicio && c.prazo_fim && c.prazo_inicio <= dia && dia <= c.prazo_fim);
    return false;
  };
  function definirPrazo(c, p) {
    const n = (v) => (/^\d+$/.test(String(v ?? '')) && +v >= 1 && +v <= 31 ? +v : null);
    const dias = [...new Set((String(p.dias || '').match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= 31))].sort((a, b) => a - b);
    const hora = String(p.hora || '').trim();
    let base;
    if (p.tipo === 'intervalo') { if (!n(p.inicio) || !n(p.fim) || +p.inicio > +p.fim) throw new Error('Informe "de" e "até" (o primeiro menor).'); base = `${p.inicio} a ${p.fim}`; }
    else if (p.tipo === 'dias') { if (!dias.length) throw new Error('Informe os dias (ex.: 9 e 27).'); base = dias.length > 1 ? `${dias.slice(0, -1).join(', ')} e ${dias.at(-1)}` : `${dias[0]}`; }
    else if (p.tipo === 'dia_util') { if (!n(p.dia_util)) throw new Error('Informe até qual dia útil.'); base = `até o ${p.dia_util}º dia útil`; }
    Object.assign(c, { prazo_tipo: ['intervalo', 'dias', 'dia_util'].includes(p.tipo) ? p.tipo : 'livre',
      prazo_inicio: p.tipo === 'intervalo' ? +p.inicio : null, prazo_fim: p.tipo === 'intervalo' ? +p.fim : null,
      prazo_dias: p.tipo === 'dias' ? dias : [], prazo_dia_util: p.tipo === 'dia_util' ? +p.dia_util : null,
      prazo_hora: base ? hora : '', prazo_texto: base ? (hora ? `${base}, até as ${hora}` : base) : String(p.livre || '').slice(0, 80) });
  }
  const fazFat = (u) => u.perfil !== 'faturista' || (u.funcao || 'ambos') !== 'xml';
  const fazXml = (u) => u.perfil !== 'faturista' || (u.funcao || 'ambos') !== 'faturamento';
  const abasDe = (u) => ABAS[u.perfil].filter((a) => (a !== 'faturamento' || fazFat(u)) && (a !== 'xml' || fazXml(u)));
  const SENHA_INICIAL = '123456';
  const senhaDe = (u) => (db.senhas ||= {})[u.id] || SENHA_INICIAL;
  const precisaTrocar = (u) => (db.trocar ||= {})[u.id] !== false;
  const perfilJson = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, abas: abasDe(u), funcao: u.funcao || 'ambos', modoDemo: false, regraGuias: 'menor', trocarSenha: precisaTrocar(u) });
  const duvidasDe = (c) => (db.duvidas ||= []).filter((d) => d.convenio_id === c.id);
  const convJson = (c) => ({ ...c, duvidas_abertas: duvidasDe(c).filter((d) => !d.resposta).length, duvidas_total: duvidasDe(c).length, faturista: nome(c.faturista_id), responsavel_xml: nome(c.xml_id), aberto_hoje: abertoHoje(c) });
  const divergencia = (l) => {
    const es = db.envios.filter((e) => e.lote_id === l.id && e.valor_protocolo != null).sort((a, b) => a.data_envio.localeCompare(b.data_envio) || a.id - b.id);
    const e = es.at(-1);
    return e && Math.abs(e.valor_protocolo - l.valor_total) >= 0.01 ? e.valor_protocolo : null;
  };
  const loteJson = (l) => ({
    ...l, convenio: conv(l.convenio_id).nome, faturista: nome(l.faturista_id), lancado_por: nome(l.lancado_por_id),
    arquivo: !!arquivos[`lote:${l.id}`], xml: xmlDe(l), valor_convenio: divergencia(l),
  });
  // Guias e valor de um lote: só a própria faturista, a gestão e a coordenação veem
  const veProducao = (u, l) => !!l && (veTodos(u) || l.faturista_id === u.id);
  const candJson = (l, u = eu()) => ({ id: l.id, numero_lote: l.numero_lote, convenio_id: l.convenio_id, convenio: conv(l.convenio_id).nome,
    faturista: nome(l.faturista_id), qtd_guias: veProducao(u, l) ? l.qtd_guias : null, valor_total: veProducao(u, l) ? l.valor_total : null, data_lancamento: l.data_lancamento, competencia: l.competencia });
  const envioJson = (e) => {
    const l = db.lotes.find((x) => x.id === e.lote_id);
    return { ...e, convenio: conv(e.convenio_id).nome, responsavel: nome(e.responsavel_id), arquivo: !!arquivos[`xml:${e.id}`],
      divergente: !!(l && e.valor_protocolo != null && Math.abs(e.valor_protocolo - l.valor_total) >= 0.01),
      lote_guias: veProducao(eu(), l) ? l.qtd_guias : null, lote_valor: veProducao(eu(), l) ? l.valor_total : null, faturista: l ? nome(l.faturista_id) : null };
  };

  function filtroLotes(q, u) {
    let ls = db.lotes;
    if (!veTodos(u)) ls = ls.filter((l) => l.faturista_id === u.id); // só a própria produção
    else if (q.get('faturista')) ls = ls.filter((l) => l.faturista_id === Number(q.get('faturista')));
    const f = (k, fn) => { if (q.get(k)) ls = ls.filter(fn(q.get(k))); };
    f('convenio', (v) => (l) => l.convenio_id === Number(v));
    f('competencia', (v) => (l) => l.competencia === v);
    f('inicio', (v) => (l) => l.data_lancamento >= v);
    f('fim', (v) => (l) => l.data_lancamento <= v);
    f('status', (v) => (l) => l.status === v);
    f('busca', (v) => (l) => l.numero_lote.includes(v));
    f('xml', (v) => (l) => xmlDe(l) === v);
    return ls;
  }
  const chaveGrupo = (por, l) => ({
    dia: l.data_lancamento, mes: l.data_lancamento.slice(0, 7), ano: l.data_lancamento.slice(0, 4), competencia: l.competencia,
    convenio: conv(l.convenio_id).nome, faturista: nome(l.faturista_id),
  }[por] ?? l.data_lancamento.slice(0, 7));
  const somar = (ls) => ({ lotes: ls.length, guias: ls.reduce((s, l) => s + l.qtd_guias, 0), valor: Math.round(ls.reduce((s, l) => s + l.valor_total, 0) * 100) / 100 });
  function agrupar(ls, chave) {
    const m = new Map();
    for (const l of ls) { const k = chave(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return [...m.entries()].map(([grupo, itens]) => ({ grupo, ...somar(itens), itens }));
  }

  // ---------- leitura do PDF (pdf.js) ----------
  async function linhasDoPdf(buffer) {
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const linhas = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const { items } = await (await doc.getPage(p)).getTextContent();
      const grupos = [];
      for (const it of items) {
        if (!it.str || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform;
        const n = Math.hypot(a, b) || 1;
        const x = e * (a / n) + f * (b / n);
        const y = e * (b / n) - f * (a / n);
        let g = grupos.find((g) => Math.abs(g.y - y) < 2.5);
        if (!g) grupos.push((g = { y, itens: [] }));
        g.itens.push({ x, s: it.str.trim() });
      }
      grupos.sort((a, b) => a.y - b.y);
      for (const g of grupos) linhas.push(g.itens.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
    }
    return linhas;
  }
  const paraNumero = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
  const CAB = /(PROTOCOLO|Seq\.?\s*protocolo|Tipo\s*protocolo):.*$/i;
  function analisar(linhas) {
    const texto = linhas.join('\n');
    const avisos = [];
    const prot = texto.match(/PROTOCOLO:\s*(\d+)(?:\s*(-)?\s*([^\s\d][^\s]*))?/i);
    const seq = texto.match(/Seq\.?\s*protocolo:\s*\(?(\d+)\)?/i);
    const numeroLote = prot?.[1] || seq?.[1] || '';
    if (!numeroLote) avisos.push('Número do lote não encontrado.');
    let convenioNome = '', convenioCodigo = '', prestador = '';
    for (let i = 0; i < Math.min(linhas.length, 8); i++) {
      const m = linhas[i].replace(CAB, '').trim().match(/^(.+?)\s*\((\d+)\)\s*$/);
      if (m) {
        convenioNome = m[1].trim(); convenioCodigo = m[2];
        for (let j = i - 1; j >= 0 && !prestador; j--) prestador = linhas[j].replace(CAB, '').trim();
        break;
      }
    }
    if (!convenioNome && prot?.[2] && prot?.[3]) convenioNome = prot[3];
    if (!convenioNome) avisos.push('Convênio não encontrado.');
    let usuarioRodape = '';
    for (const l of linhas.slice(-6).reverse()) {
      const m = l.match(/\b([a-z][\w-]*\.[a-z][\w.-]*)\b/i) || l.match(/\b([a-z][\w.-]*)\s+FatAct_\w+/i);
      if (m && !/^FatAct/i.test(m[1])) { usuarioRodape = m[1]; break; }
    }
    const tipo = texto.match(/Tipo\s*protocolo:\s*([^\n]+?)\s*(?:\n|$)/i)?.[1]?.trim() || '';
    const per = texto.match(/Per[ií]odo\s+de\s+(\d{2}\/\d{2}\/\d{4}).*?at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i);
    const isoBR = (d) => (d ? d.split('/').reverse().join('-') : '');
    let guiasTexto = '', qtdGuias = 0, valorTotal = 0;
    const lt = linhas.find((l) => /Total\s+do\s+protocolo/i.test(l)) || '';
    const fr = lt.match(/(\d+)\s*\/\s*(\d+)/);
    if (fr) { guiasTexto = `${fr[1]}/${fr[2]}`; qtdGuias = Math.min(Number(fr[1]), Number(fr[2])); } // 80/74 → 74 guias
    const vals = (lt.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(paraNumero);
    if (vals.length) valorTotal = Math.max(...vals);
    if (!qtdGuias) avisos.push('Quantidade de guias não encontrada.');
    if (!valorTotal) avisos.push('Valor total não encontrado.');
    const cont = {};
    for (const l of linhas) for (const r of l.match(/\b\d{9,}\s+(\d{2})\/(\d{2})\b/g) || []) {
      const [, mm, aa] = r.match(/(\d{2})\/(\d{2})$/);
      if (+mm >= 1 && +mm <= 12) cont[`20${aa}-${mm}`] = (cont[`20${aa}-${mm}`] || 0) + 1;
    }
    let competencia = Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    if (!competencia && per) competencia = isoBR(per[2]).slice(0, 7);
    return { numeroLote, convenioNome, convenioCodigo, prestador, tipo, periodoInicio: isoBR(per?.[1]), periodoFim: isoBR(per?.[2]),
      competencia, guiasTexto, qtdGuias, valorTotal, avisos, usuarioRodape, sufixoProtocolo: prot?.[3] || '', sufixoComHifen: !!prot?.[2],
      numeros: [...new Set(texto.match(/\b\d{4,12}\b/g) || [])], leitura: 'texto' };
  }
  const acharConvenio = (n, cod) => (cod && db.convenios.find((c) => c.codigo === cod)) || db.convenios.find((c) => n && normalizar(c.nome) === normalizar(n));
  const acharPessoa = (t) => {
    const ch = new Set([normalizar(t), normalizar(String(t).split('.')[0])]);
    ch.delete('');
    return db.usuarios.find((u) => u.ativo && [normalizar(u.nome), normalizar(u.login)].some((k) => ch.has(k)));
  };
  function quemGerou(d) {
    if (d.sufixoProtocolo) {
      const p = acharPessoa(d.sufixoProtocolo);
      const pareceConv = d.sufixoComHifen || acharConvenio(d.sufixoProtocolo) || normalizar(d.convenioNome).includes(normalizar(d.sufixoProtocolo));
      if (p || !pareceConv) return [d.sufixoProtocolo, 'topo', p];
    }
    if (d.usuarioRodape) return [d.usuarioRodape, 'rodapé', acharPessoa(d.usuarioRodape)];
    return ['', '', null];
  }
  function resolverConvenio(b) {
    if (b.convenioId) return conv(b.convenioId);
    const n = String(b.convenioNome || '').trim();
    if (!n) return null;
    let c = acharConvenio(n, b.convenioCodigo);
    if (!c) { c = { id: novoId(db.convenios), nome: n, codigo: b.convenioCodigo || null, ativo: true, tem_xml: true, faturista_id: null, xml_id: null, prazo_texto: '', prazo_inicio: null, prazo_fim: null }; db.convenios.push(c); }
    return c;
  }
  const lotesSemXml = (q, u) => db.lotes.filter((l) => conv(l.convenio_id).tem_xml && !temEnvio(l))
    .filter((l) => (veTodos(u) ? !q.get('responsavel') || conv(l.convenio_id).xml_id === Number(q.get('responsavel')) : conv(l.convenio_id).xml_id === u.id));
  const amarrar = (l) => { let n = 0; for (const e of db.envios) if (!e.lote_id && e.numero_lote === l.numero_lote && e.convenio_id === l.convenio_id) { e.lote_id = l.id; n++; } return n; };
  const lerValor = (v) => { if (v == null || v === '') return null; const t = String(v).trim(); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  function guardarPendente(file) { const t = Math.random().toString(16).slice(2) + Date.now().toString(16); pendentes[t] = file; return t; }
  function anexar(chave, token) { const f = pendentes[token]; if (f) { arquivos[chave] = URL.createObjectURL(f); delete pendentes[token]; } }
  const entregaJson = (e, u) => {
    const c = conv(e.convenio_id);
    const meu = [c.faturista_id, c.xml_id].includes(u.id);
    return { ...e, convenio: c.nome, concluido_por: nome(e.concluido_por_id), faturista_id: c.faturista_id, faturista: nome(c.faturista_id),
      xml_id: c.xml_id, responsavel_xml: nome(c.xml_id), tem_xml: c.tem_xml, meu, pode_concluir: meu || veTodos(u) };
  };
  const validarLote = (b) => (!String(b.numeroLote || '').trim() ? 'Informe o número do lote.' : !(Number(b.qtdGuias) > 0) ? 'Quantidade de guias inválida.'
    : !/^\d{4}-\d{2}$/.test(b.competencia || '') ? 'Competência inválida.' : !/^\d{4}-\d{2}-\d{2}$/.test(b.dataLancamento || '') ? 'Data inválida.' : null);

  // ---------- dúvidas sobre convênios ----------
  const duvJson = (d) => ({ ...d, convenio: conv(d.convenio_id)?.nome || '', autor: d.autor_id ? nome(d.autor_id) : (d.autor_nome || 'Consulta sem login'),
    respondida_por: d.respondida_por_id ? nome(d.respondida_por_id) : null });
  function criarDuvida(corpo, autor) {
    const c = conv(corpo.convenioId); const texto = String(corpo.texto || '').trim();
    if (!c || !texto) return erro('Escolha o convênio e escreva a dúvida.');
    const nomeP = autor ? '' : String(corpo.nome || '').trim().slice(0, 80);
    if (!autor && !nomeP) return erro('Informe o seu nome.');
    db.duvidas ||= [];
    const d = { id: novoId(db.duvidas), convenio_id: c.id, autor_id: autor?.id || null, autor_nome: nomeP, texto: texto.slice(0, 2000),
      criado_em: new Date().toISOString().slice(0, 16), resposta: '', respondida_por_id: null, respondida_em: null };
    db.duvidas.push(d); salvar(); return json(duvJson(d));
  }

  // ---------- rotas ----------
  async function rota(metodo, caminho, q, corpo) {
    const p = caminho.split('/').filter(Boolean).slice(1); // sem "api"
    const [r0, r1, r2] = p;
    if (r0 === 'entrar' && r1 === 'pessoas') return json(db.usuarios.filter((u) => u.ativo).map((u) => ({ nome: u.nome, login: u.login, perfil: u.perfil, semSenha: false })));
    if (r0 === 'entrar') {
      const u = db.usuarios.find((x) => x.login === corpo.login && x.ativo);
      if (!u || String(corpo.senha || '') !== senhaDe(u)) return erro('Usuário ou senha inválidos.', 401);
      db.usuarioAtual = u.id; salvar(); return json(perfilJson(u));
    }
    // Consulta sem login ("Todos"): só convênios e calendário, só leitura
    if (r0 === 'publico') {
      if (r1 === 'duvidas' && metodo === 'POST') return criarDuvida(corpo, null);
      if (metodo !== 'GET') return erro('Só consulta.', 405);
      const anon = { id: 0, perfil: 'publico' };
      const entPub = (e) => ({ ...entregaJson(e, anon), meu: false, pode_concluir: false, concluido_por: null });
      if (r1 === 'duvidas') return json((db.duvidas || []).filter((d) => d.convenio_id === Number(q.get('convenio'))).sort((a, b) => b.id - a.id).map(duvJson));
      if (r1 === 'convenios') return json(db.convenios.filter((c) => c.ativo).sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome))).map(convJson));
      if (r1 === 'pessoas') return json(db.usuarios.filter((x) => x.ativo).map((x) => ({ id: x.id, nome: x.nome, perfil: x.perfil, funcao: x.funcao || 'ambos', fatura: fazFat(x), xml: fazXml(x) })).sort((a, b) => a.nome.localeCompare(b.nome)));
      if (r1 === 'calendario' && r2 === 'proximos') {
        const dias = [...new Set(db.entregas.filter((e) => e.data >= hoje()).map((e) => e.data))].sort().slice(0, 3);
        return json({ hoje: hoje(), entregas: db.entregas.filter((e) => dias.includes(e.data)).map(entPub) });
      }
      if (r1 === 'calendario') {
        const mes = q.get('mes') || hoje().slice(0, 7);
        return json({ mes, hoje: hoje(), entregas: db.entregas.filter((e) => e.data.startsWith(mes)).sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id).map(entPub),
          feriados: db.feriados.filter((f) => f.data.startsWith(mes)) });
      }
      return erro('Não encontrado.', 404);
    }
    if (r0 === 'sair') { db.usuarioAtual = null; salvar(); return json({ ok: true }); }
    const u = eu();
    if (!u) return erro('Faça login.', 401);
    const pode = (aba) => ABAS[u.perfil].includes(aba) || abasDe(u).includes(aba);
    if (r0 === 'eu') return json(perfilJson(u));
    if (r0 === 'senha') {
      if (String(corpo.atual || '') !== senhaDe(u)) return erro('A senha atual não confere.');
      const nova = String(corpo.nova || '');
      if (nova.length < 6) return erro('A senha nova precisa de pelo menos 6 caracteres.');
      if (nova === senhaDe(u) || nova === SENHA_INICIAL) return erro('Escolha uma senha diferente da atual e da senha inicial.');
      if (nova !== String(corpo.confirmacao || '')) return erro('A confirmação não é igual à senha nova.');
      db.senhas[u.id] = nova; db.trocar[u.id] = false; salvar();
      return json(perfilJson(u));
    }
    if (precisaTrocar(u)) return new Response(JSON.stringify({ erro: 'Troque sua senha para continuar.', trocarSenha: true }), { status: 428, headers: { 'content-type': 'application/json' } });
    if (r0 === 'pessoas') return json(db.usuarios.filter((x) => x.ativo).map((x) => ({ id: x.id, nome: x.nome, perfil: x.perfil, funcao: x.funcao || 'ambos', fatura: fazFat(x), xml: fazXml(x) })).sort((a, b) => a.nome.localeCompare(b.nome)));

    if (r0 === 'usuarios') {
      if (!pode('gestao')) return erro('Sem acesso.', 403);
      if (metodo === 'GET') return json([...db.usuarios].sort((a, b) => a.nome.localeCompare(b.nome)).map((x) => ({ ...x, trocar_senha: precisaTrocar(x) })));
      if (metodo === 'POST') {
        if (db.usuarios.some((x) => x.login === corpo.login)) return erro('Login já existe.', 409);
        db.usuarios.push({ id: novoId(db.usuarios), nome: corpo.nome, login: String(corpo.login).toLowerCase(), perfil: corpo.perfil, funcao: corpo.funcao || 'ambos', ativo: true, criado_em: hoje() });
      } else {
        Object.assign(pessoa(r1), { nome: corpo.nome, perfil: corpo.perfil, funcao: corpo.funcao || 'ambos', ativo: !!corpo.ativo });
        if (corpo.redefinir) { delete (db.senhas ||= {})[Number(r1)]; (db.trocar ||= {})[Number(r1)] = true; } // volta para 123456
      }
      salvar(); return json({ ok: true });
    }

    if (r0 === 'convenios') {
      if (metodo === 'GET') return json([...db.convenios].sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome))).map(convJson));
      const soPrazo = metodo === 'PUT' && Object.keys(corpo).every((k) => k === 'prazo' || k === 'particularidades');
      if (soPrazo ? !pode('gestao') : !pode('coordenacao')) return erro('Só a coordenação muda isso. A supervisão pode mudar o prazo do portal.', 403);
      if (soPrazo) {
        const c = conv(r1);
        if (corpo.prazo) { try { definirPrazo(c, corpo.prazo); } catch (e) { return erro(e.message); } }
        if (corpo.particularidades) { const p2 = corpo.particularidades;
          for (const k of ['pacote', 'precisa_autorizacao', 'precisa_guia', 'precisa_senha']) if (k in p2) c[k] = p2[k] === null ? null : !!p2[k];
          if ('texto' in p2) c.particularidades = String(p2.texto || '').trim().slice(0, 4000); }
        salvar(); return json(convJson(c));
      }
      if (metodo === 'DELETE') {
        if (db.lotes.some((l) => l.convenio_id === Number(r1))) return erro('Esse convênio já tem lotes. Desative em vez de excluir.', 409);
        db.convenios = db.convenios.filter((c) => c.id !== Number(r1)); salvar(); return json({ ok: true });
      }
      const c = metodo === 'POST' ? { id: novoId(db.convenios), nome: '', codigo: null, ativo: true, tem_xml: true, faturista_id: null, xml_id: null, prazo_texto: '', prazo_inicio: null, prazo_fim: null } : conv(r1);
      for (const [k, v] of Object.entries(corpo)) {
        if (['faturista_id', 'xml_id', 'prazo_inicio', 'prazo_fim'].includes(k)) c[k] = v === '' || v == null ? null : Number(v);
        else if (['ativo', 'tem_xml'].includes(k)) c[k] = !!v;
        else if (['nome', 'codigo', 'prazo_texto'].includes(k)) c[k] = v;
      }
      if (metodo === 'POST') db.convenios.push(c);
      salvar(); return json(convJson(c));
    }

    if (r0 === 'demonstracao') {
      db.envios = db.envios.filter((e) => !e.demo); const antes = db.lotes.length; db.lotes = db.lotes.filter((l) => !l.demo);
      salvar(); return json({ apagados: antes - db.lotes.length });
    }

    if (r0 === 'lotes') {
      if (r1 === 'extrair') {
        const f = corpo.get('pdf');
        if (!/\.pdf$/i.test(f.name)) return erro('Na demonstração, foto/escaneado (OCR) não está disponível. Use um PDF com texto.', 422);
        const d = analisar(await linhasDoPdf(await f.arrayBuffer()));
        const [g, origem, pes] = quemGerou(d);
        Object.assign(d, { geradoPor: g, geradoPorOrigem: origem, faturistaId: pes?.id || null, faturistaNome: pes?.nome || null });
        if (g && !pes) d.avisos.push(`"${g}" (quem gerou, no ${origem}) não está cadastrado na equipe. Escolha o faturista.`);
        const c = acharConvenio(d.convenioNome, d.convenioCodigo);
        if (c && db.lotes.some((l) => l.numero_lote === d.numeroLote && l.convenio_id === c.id)) d.avisos.push('Este lote já foi lançado para este convênio.');
        return json({ ...d, arquivoId: guardarPendente(f), convenioId: c?.id || null, nomeArquivo: f.name });
      }
      if (metodo === 'GET' && !r1) return json(filtroLotes(q, u).sort((a, b) => b.data_lancamento.localeCompare(a.data_lancamento) || b.id - a.id).slice(0, 1000).map(loteJson));
      if (metodo === 'POST') {
        const msg = validarLote(corpo); if (msg) return erro(msg);
        const c = resolverConvenio(corpo); if (!c) return erro('Informe o convênio.');
        if (db.lotes.some((l) => l.numero_lote === String(corpo.numeroLote).trim() && l.convenio_id === c.id)) return erro('Este lote já foi lançado para este convênio.', 409);
        const l = { id: novoId(db.lotes), numero_lote: String(corpo.numeroLote).trim(), convenio_id: c.id, faturista_id: Number(corpo.faturistaId) || u.id,
          lancado_por_id: u.id, gerado_por: corpo.geradoPor || '', qtd_guias: Number(corpo.qtdGuias), guias_texto: corpo.guiasTexto || '',
          valor_total: Number(corpo.valorTotal), competencia: corpo.competencia, periodo_inicio: corpo.periodoInicio || null, periodo_fim: corpo.periodoFim || null,
          tipo: corpo.tipo || '', prestador: corpo.prestador || '', status: 'lancado', observacao: corpo.observacao || '', data_lancamento: corpo.dataLancamento, demo: false };
        db.lotes.push(l); const n = amarrar(l); anexar(`lote:${l.id}`, corpo.arquivoId); salvar();
        return json({ id: l.id, xmlAmarrados: n });
      }
      const l = db.lotes.find((x) => x.id === Number(r1));
      if (!l) return erro('Lote não encontrado.', 404);
      if (!veTodos(u) && l.faturista_id !== u.id) return erro('Sem acesso.', 403);
      if (r2 === 'status') { if (!pode('gestao')) return erro('Sem acesso.', 403); l.status = corpo.status; if (corpo.observacao != null) l.observacao = corpo.observacao; salvar(); return json({ ok: true }); }
      if (!veTodos(u) && l.status === 'conferido') return erro('Lote já conferido. Peça à gestão.', 403);
      if (metodo === 'DELETE') { db.lotes = db.lotes.filter((x) => x !== l); db.envios.forEach((e) => { if (e.lote_id === l.id) e.lote_id = null; }); salvar(); return json({ ok: true }); }
      const msg = validarLote(corpo); if (msg) return erro(msg);
      Object.assign(l, { numero_lote: String(corpo.numeroLote).trim(), convenio_id: (resolverConvenio(corpo) || conv(l.convenio_id)).id,
        faturista_id: Number(corpo.faturistaId) || l.faturista_id, qtd_guias: Number(corpo.qtdGuias), valor_total: Number(corpo.valorTotal),
        competencia: corpo.competencia, data_lancamento: corpo.dataLancamento, periodo_inicio: corpo.periodoInicio || null, periodo_fim: corpo.periodoFim || null,
        tipo: corpo.tipo || '', observacao: corpo.observacao || '' });
      if (!veTodos(u) && l.status === 'devolvido') l.status = 'lancado';
      const n = amarrar(l); salvar(); return json({ ok: true, xmlAmarrados: n });
    }

    if (r0 === 'xml') {
      if (r1 === 'ler') {
        const f = corpo.get('arquivo');
        let d = { numeroLote: '', convenioNome: '', convenioCodigo: '', numeros: [], tipo: 'outro' };
        const avisos = [];
        if (/\.pdf$/i.test(f.name)) { const a = analisar(await linhasDoPdf(await f.arrayBuffer())); d = { ...a, tipoProtocolo: a.tipo, tipo: 'pdf' }; d.valor = d.valorTotal || null; }
        else if (/\.xml$/i.test(f.name)) {
          const t = await f.text(); const tag = (n) => t.match(new RegExp(`<(?:\\w+:)?${n}>\\s*([^<\\s]+)`))?.[1] || '';
          const soma = (t.match(/<(?:\w+:)?valorTotalGeral>\s*([\d.]+)/g) || []).reduce((s2, m) => s2 + Number(m.replace(/.*>\s*/, '')), 0);
          d = { numeroLote: tag('numeroLote'), convenioCodigo: tag('registroANS'), convenioNome: '', protocolo: tag('numeroProtocolo'), numeros: t.match(/\b\d{4,12}\b/g) || [], tipo: 'xml', valor: soma || null };
        } else avisos.push('Na demonstração, foto (OCR) não é lida: escolha o lote abaixo ou digite o número.');
        let c = acharConvenio(d.convenioNome, d.convenioCodigo);
        const doFat = q.get('contexto') === 'faturamento' && !veTodos(u);
        const baseL = doFat ? db.lotes.filter((l) => l.faturista_id === u.id) : db.lotes;
        let cand = d.numeroLote ? baseL.filter((l) => l.numero_lote === d.numeroLote) : [];
        if (c && cand.some((l) => l.convenio_id === c.id)) cand = cand.filter((l) => l.convenio_id === c.id);
        if (!cand.length && d.numeros.length) cand = (doFat ? baseL.filter((l) => conv(l.convenio_id).tem_xml && !temEnvio(l)) : lotesSemXml(q, u)).filter((l) => d.numeros.includes(l.numero_lote)).slice(0, 10);
        const lote = cand.length === 1 ? cand[0] : null;
        if (lote) c = conv(lote.convenio_id);
        const naoLancado = !!(d.numeroLote && !cand.length);
        if (!d.numeroLote && !cand.length && !avisos.length) avisos.push('Não achei o número do lote no arquivo. Escolha o lote na lista ou digite o número.');
        return json({ arquivoId: guardarPendente(f), nomeArquivo: f.name, tipo: d.tipo, numeroLote: lote?.numero_lote || d.numeroLote, convenioId: c?.id || null,
          convenioNome: d.convenioNome, protocolo: d.protocolo || '', valorProtocolo: d.valor ?? null, loteId: lote?.id || null,
          loteNaoLancado: naoLancado, podeLancar: fazFat(u),
          extraidos: d.numeroLote ? (() => { const [g, origem, pes] = d.usuarioRodape !== undefined ? quemGerou(d) : ['', '', null];
            return { numeroLote: d.numeroLote, convenioNome: d.convenioNome, convenioCodigo: d.convenioCodigo, qtdGuias: d.qtdGuias, guiasTexto: d.guiasTexto,
              competencia: d.competencia, periodoInicio: d.periodoInicio, periodoFim: d.periodoFim, tipo: d.tipoProtocolo, prestador: d.prestador,
              valorTotal: d.valor ?? null, geradoPor: g, geradoPorOrigem: origem, faturistaId: pes?.id || null, faturistaNome: pes?.nome || null,
              convenioId: (c || acharConvenio(d.convenioNome, d.convenioCodigo))?.id || null }; })() : null, candidatos: cand.map(candJson), avisos });
      }
      if (r1 === 'pendentes') return json(lotesSemXml(q, u).sort((a, b) => a.data_lancamento.localeCompare(b.data_lancamento))
        .map((l) => ({ ...candJson(l), prazo_texto: conv(l.convenio_id).prazo_texto, aberto_hoje: abertoHoje(conv(l.convenio_id)), responsavel_xml: nome(conv(l.convenio_id).xml_id) })));
      const meus = () => db.envios.filter((e) => (veTodos(u) ? !q.get('responsavel') || e.responsavel_id === Number(q.get('responsavel')) : e.responsavel_id === u.id));
      if (r1 === 'resumo') {
        const pend = lotesSemXml(q, u); const mes = hoje().slice(0, 8) + '01';
        return json({ pendentes: pend.length, pendentesValor: veTodos(u) ? pend.reduce((s, l) => s + l.valor_total, 0) : null, enviadosMes: meus().filter((e) => e.data_envio >= mes).length, aguardandoLote: meus().filter((e) => !e.lote_id).length });
      }
      if (metodo === 'GET' && !r1) {
        let es = meus();
        if (q.get('situacao') === 'amarrado') es = es.filter((e) => e.lote_id); if (q.get('situacao') === 'aguardando') es = es.filter((e) => !e.lote_id);
        if (q.get('busca')) es = es.filter((e) => e.numero_lote.includes(q.get('busca')) || (e.protocolo || '').includes(q.get('busca')));
        return json(es.sort((a, b) => b.data_envio.localeCompare(a.data_envio) || b.id - a.id).slice(0, 1000).map(envioJson));
      }
      if (metodo === 'POST') {
        let lote = corpo.loteId ? db.lotes.find((l) => l.id === Number(corpo.loteId)) : null;
        const numero = lote ? lote.numero_lote : String(corpo.numeroLote || '').trim();
        const c = lote ? conv(lote.convenio_id) : conv(corpo.convenioId);
        if (!numero || !c) return erro('Informe o número do lote e o convênio.');
        if (!c.tem_xml) return erro(`${c.nome} está marcado como convênio sem XML.`);
        lote ||= db.lotes.find((l) => l.numero_lote === numero && l.convenio_id === c.id) || null;
        const e = { id: novoId(db.envios), numero_lote: numero, convenio_id: c.id, lote_id: lote?.id || null, responsavel_id: veTodos(u) && corpo.responsavelId ? Number(corpo.responsavelId) : u.id,
          protocolo: corpo.protocolo || '', data_envio: corpo.dataEnvio, nome_arquivo: corpo.nomeArquivo || '', observacao: corpo.observacao || '', demo: false,
          valor_protocolo: lerValor(corpo.valorProtocolo) };
        db.envios.push(e); anexar(`xml:${e.id}`, corpo.arquivoId); salvar();
        const diverge = !!(lote && e.valor_protocolo != null && Math.abs(e.valor_protocolo - lote.valor_total) >= 0.01);
        return json({ id: e.id, amarrado: !!lote, numeroLote: numero, divergente: diverge, faturista: diverge ? nome(lote.faturista_id) : null });
      }
      const e = db.envios.find((x) => x.id === Number(r1));
      if (metodo === 'DELETE') { db.envios = db.envios.filter((x) => x !== e); salvar(); return json({ ok: true }); }
      Object.assign(e, { numero_lote: corpo.numeroLote, convenio_id: Number(corpo.convenioId), data_envio: corpo.dataEnvio, protocolo: corpo.protocolo || '', observacao: corpo.observacao || '', valor_protocolo: lerValor(corpo.valorProtocolo) });
      e.lote_id = db.lotes.find((l) => l.numero_lote === e.numero_lote && l.convenio_id === e.convenio_id)?.id || null;
      salvar(); return json({ ok: true, amarrado: !!e.lote_id });
    }

    if (r0 === 'versao') return json({ versao: `${db.lotes.length}:${db.envios.length}:${db.entregas.filter((e) => e.concluido).length}:${JSON.stringify(db.lotes.map((l) => l.status)).length}` });

    if (r0 === 'duvidas') {
      db.duvidas ||= [];
      if (metodo === 'POST' && !r1) return criarDuvida(corpo, u);
      if (metodo === 'GET') {
        if (q.get('abertas')) { if (!pode('gestao')) return erro('Sem acesso.', 403); return json(db.duvidas.filter((d) => !d.resposta).sort((a, b) => a.id - b.id).map(duvJson)); }
        return json(db.duvidas.filter((d) => d.convenio_id === Number(q.get('convenio'))).sort((a, b) => b.id - a.id).map(duvJson));
      }
      if (!pode('gestao')) return erro('Sem acesso.', 403);
      const d = db.duvidas.find((x) => x.id === Number(r1));
      if (!d) return erro('Dúvida não encontrada.', 404);
      if (metodo === 'DELETE') { db.duvidas = db.duvidas.filter((x) => x !== d); salvar(); return json({ ok: true }); }
      const resp = String(corpo.resposta || '').trim(); if (!resp) return erro('Escreva a resposta.');
      Object.assign(d, { resposta: resp, respondida_por_id: u.id, respondida_em: new Date().toISOString().slice(0, 16) }); salvar();
      return json(duvJson(d));
    }

    if (r0 === 'minha-producao') {
      const ini = q.get('inicio') || '';
      const fim = q.get('fim') || hoje();
      const dentro = (d) => (!ini || d >= ini) && d <= fim;
      const lotes = db.lotes.filter((l) => l.faturista_id === u.id && dentro(l.data_lancamento)).sort((a2, b2) => b2.data_lancamento.localeCompare(a2.data_lancamento) || b2.id - a2.id);
      const envios = db.envios.filter((e) => e.responsavel_id === u.id && dentro(e.data_envio)).sort((a2, b2) => b2.data_envio.localeCompare(a2.data_envio) || b2.id - a2.id);
      const loteDe = (e) => db.lotes.find((l) => l.id === e.lote_id);
      const vEnv = (e) => loteDe(e)?.valor_total ?? e.valor_protocolo ?? 0;
      const gEnv = (e) => loteDe(e)?.qtd_guias ?? 0;
      const r2 = (v) => Math.round(v * 100) / 100;
      const primeiro = ini || [...lotes.map((l) => l.data_lancamento), ...envios.map((e) => e.data_envio), fim].sort()[0];
      const porMes = (new Date(`${fim}T12:00:00`) - new Date(`${primeiro}T12:00:00`)) / 864e5 > 62;
      const chave = (d) => (porMes ? d.slice(0, 7) : d);
      const serie = {};
      for (let d = new Date(`${porMes ? primeiro.slice(0, 8) + '01' : primeiro}T12:00:00`); iso(d) <= fim; porMes ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 1)) serie[chave(iso(d))] = { periodo: chave(iso(d)), lotes: 0, lotesQtd: 0, xmls: 0 };
      for (const l of lotes) { const g = serie[chave(l.data_lancamento)] ||= { periodo: chave(l.data_lancamento), lotes: 0, lotesQtd: 0, xmls: 0 }; g.lotes = r2(g.lotes + l.valor_total); g.lotesQtd++; }
      for (const e of envios) { const g = serie[chave(e.data_envio)] ||= { periodo: chave(e.data_envio), lotes: 0, lotesQtd: 0, xmls: 0 }; g.xmls++; }
      const porConv = (itens, nomeF, valorF) => {
        const g = {};
        for (const i of itens) { const k = nomeF(i); g[k] ||= { grupo: k, qtd: 0, valor: 0 }; g[k].qtd++; g[k].valor = r2(g[k].valor + valorF(i)); }
        return Object.values(g).sort((a2, b2) => b2.valor - a2.valor);
      };
      return json({
        fatura: fazFat(u), xml: fazXml(u), hoje: hoje(), inicio: ini || null, fim, porMes,
        lotes: { qtd: lotes.length, guias: lotes.reduce((a2, x) => a2 + x.qtd_guias, 0), valor: r2(lotes.reduce((a2, x) => a2 + x.valor_total, 0)) },
        xmls: { qtd: envios.length, guias: envios.reduce((a2, x) => a2 + gEnv(x), 0), valor: r2(envios.reduce((a2, x) => a2 + vEnv(x), 0)) },
        serie: Object.keys(serie).sort().map((k) => serie[k]),
        convenios: porConv(lotes, (l) => conv(l.convenio_id).nome, (l) => l.valor_total),
        conveniosXml: porConv(envios, (e) => conv(e.convenio_id).nome, vEnv),
        listaLotes: lotes.slice(0, 100).map((l) => ({ numero_lote: l.numero_lote, convenio: conv(l.convenio_id).nome, data: l.data_lancamento, guias: l.qtd_guias, valor: l.valor_total, status: l.status })),
        listaXmls: envios.slice(0, 100).map((e) => ({ numero_lote: e.numero_lote, convenio: conv(e.convenio_id).nome, data: e.data_envio, guias: gEnv(e), valor: vEnv(e), amarrado: !!e.lote_id })),
      });
    }

    if (r0 === 'mensagens') {
      // Na demonstração as mensagens ficam neste navegador: troque de pessoa para ver a conversa do outro lado
      db.mensagens ||= []; db.lidaEquipe ||= {};
      const daConversa = (com) => db.mensagens.filter((m) => (com === 'equipe' ? m.para == null
        : (m.de === u.id && m.para === Number(com)) || (m.de === Number(com) && m.para === u.id)));
      const msgJson = (m) => ({ id: m.id, autor: nome(m.de), autor_id: m.de, minha: m.de === u.id, texto: m.texto, criado_em: m.criado_em });
      const naoLidas = () => {
        const equipe = db.mensagens.filter((m) => m.para == null && m.de !== u.id && m.id > (db.lidaEquipe[u.id] || 0)).length;
        const porPessoa = {};
        for (const m of db.mensagens) if (m.para === u.id && !m.lida) porPessoa[m.de] = (porPessoa[m.de] || 0) + 1;
        return [equipe, porPessoa];
      };
      if (r1 === 'resumo') {
        const [e, pp] = naoLidas();
        const pend = db.mensagens.filter((m) => m.de !== u.id && ((m.para === u.id && !m.lida) || (m.para == null && m.id > (db.lidaEquipe[u.id] || 0))));
        const m = pend.at(-1);
        return json({ naoLidas: e + Object.values(pp).reduce((a2, b) => a2 + b, 0),
          ultima: m ? { ...msgJson(m), conversa: m.para == null ? 'equipe' : String(m.de), equipe: m.para == null } : null });
      }
      if (r1 === 'conversas') {
        const [e, pp] = naoLidas();
        const ult = (com) => { const l = daConversa(com); return l.length ? msgJson(l.at(-1)) : null; };
        const outros = db.usuarios.filter((x) => x.ativo && x.id !== u.id).map((x) => ({ chave: String(x.id), nome: x.nome, perfil: x.perfil, naoLidas: pp[x.id] || 0, ultima: ult(String(x.id)) }))
          .sort((a2, b) => ((b.ultima || {}).id || 0) - ((a2.ultima || {}).id || 0) || a2.nome.localeCompare(b.nome));
        return json([{ chave: 'equipe', nome: 'Equipe toda', naoLidas: e, ultima: ult('equipe') }, ...outros]);
      }
      const com = String(q.get('com') || corpo.com || 'equipe');
      if (metodo === 'POST') {
        const texto = String(corpo.texto || '').trim();
        if (!texto) return erro('Escreva a mensagem.');
        const m = { id: novoId(db.mensagens), de: u.id, para: com === 'equipe' ? null : Number(com), texto: texto.slice(0, 2000), criado_em: new Date().toISOString(), lida: false };
        db.mensagens.push(m); salvar(); return json(msgJson(m));
      }
      const conv2 = daConversa(com);
      const depois = Number(q.get('depois') || 0);
      if (com === 'equipe') db.lidaEquipe[u.id] = Math.max(db.lidaEquipe[u.id] || 0, ...conv2.map((m) => m.id), 0);
      else conv2.forEach((m) => { if (m.para === u.id) m.lida = true; });
      salvar();
      return json((depois ? conv2.filter((m) => m.id > depois) : conv2.slice(-100)).map(msgJson));
    }

    if (r0 === 'alertas') {
      // Último dia do portal (hoje / próximo dia útil) e próximo envio do calendário
      const fer = new Set(db.feriados.map((f) => f.data));
      const agora = new Date(`${hoje()}T12:00:00`);
      const util = new Date(agora); do util.setDate(util.getDate() + 1); while (util.getDay() % 6 === 0 || fer.has(iso(util)));
      const abertoEm = (c, dt) => {
        if (c.prazo_tipo === 'dias') return (c.prazo_dias || []).includes(dt.getDate());
        if (c.prazo_tipo === 'intervalo') return !!(c.prazo_inicio && c.prazo_fim && c.prazo_inicio <= dt.getDate() && dt.getDate() <= c.prazo_fim);
        if (c.prazo_tipo === 'dia_util') { const n = diaUtil(dt); return !!(c.prazo_dia_util && n > 0 && n <= c.prazo_dia_util); }
        return false;
      };
      const meus = db.convenios.filter((c) => c.ativo && c.prazo_tipo !== 'livre' && (veTodos(u) || [c.faturista_id, c.xml_id].includes(u.id)));
      const hojeUlt = [], logoUlt = [];
      for (const c of meus) {
        let ultimo = null;
        for (let dt = new Date(agora.getFullYear(), agora.getMonth(), 1, 12); dt.getMonth() === agora.getMonth(); dt.setDate(dt.getDate() + 1)) if (abertoEm(c, dt)) ultimo = iso(dt);
        if (ultimo === hoje()) hojeUlt.push(c.nome); else if (ultimo && ultimo > hoje() && ultimo <= iso(util)) logoUlt.push(c.nome);
      }
      const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
      const rot = (s2) => { const dt = new Date(`${s2}T12:00:00`); return `${SEM[dt.getDay()]} ${s2.slice(8)}/${s2.slice(5, 7)}`; };
      const amanha = addDias(hoje(), 1);
      const lista = [];
      if (hojeUlt.length) lista.push({ nivel: 'urgente', titulo: 'Último dia do portal hoje', itens: hojeUlt.sort() });
      if (logoUlt.length) lista.push({ nivel: 'atencao', titulo: `Último dia do portal: ${iso(util) === amanha ? 'amanhã' : rot(iso(util))}`, itens: logoUlt.sort() });
      const ents = db.entregas.filter((e) => e.data >= hoje() && !e.concluido && (veTodos(u) || [conv(e.convenio_id).faturista_id, conv(e.convenio_id).xml_id].includes(u.id)));
      if (ents.length) {
        const dia = ents.map((e) => e.data).sort()[0];
        const itens = [...new Set(ents.filter((e) => e.data === dia).map((e) => conv(e.convenio_id).nome))].sort();
        if (dia === hoje()) lista.push({ nivel: 'urgente', titulo: 'Envio de hoje (calendário)', itens, aba: 'calendario' });
        else if (dia === iso(util)) lista.push({ nivel: 'atencao', titulo: `Próximo envio: ${dia === amanha ? 'amanhã' : rot(dia)} — entregue hoje ao setor`, itens, aba: 'calendario' });
        else lista.push({ nivel: 'info', titulo: `Próximo envio: ${rot(dia)}`, itens, aba: 'calendario' });
      }
      const br = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const div = db.lotes.filter((l) => (veTodos(u) || l.faturista_id === u.id) && divergencia(l) != null)
        .map((l) => `lote ${l.numero_lote} (${conv(l.convenio_id).nome}): sistema ${br(l.valor_total)} · convênio ${br(divergencia(l))}`);
      if (div.length) lista.unshift({ nivel: 'urgente', aba: veTodos(u) ? 'gestao' : 'faturamento', itens: div,
        titulo: veTodos(u) ? 'Lotes com valor diferente do protocolo do convênio' : 'Valor diferente do protocolo do convênio — corrija o lote' });
      const abertasD = (db.duvidas || []).filter((d) => !d.resposta);
      if (pode('gestao') && abertasD.length) lista.unshift({ nivel: 'atencao', aba: 'convenios', titulo: `${abertasD.length} dúvida(s) sobre convênios para responder`, itens: [...new Set(abertasD.map((d) => conv(d.convenio_id).nome))].sort() });
      return json({ hoje: hoje(), alertas: lista });
    }

    if (r0 === 'calendario') {
      if (r1 === 'proximos') {
        const dias = [...new Set(db.entregas.filter((e) => e.data >= hoje()).map((e) => e.data))].sort().slice(0, 3);
        return json({ hoje: hoje(), entregas: db.entregas.filter((e) => dias.includes(e.data)).map((e) => entregaJson(e, u)) });
      }
      if (r1 === 'feriado') {
        if (!pode('gestao')) return erro('Sem acesso.', 403);
        db.feriados = db.feriados.filter((f) => f.data !== corpo.data);
        if (corpo.feriado) db.feriados.push({ data: corpo.data, descricao: corpo.descricao || 'Feriado' });
        salvar(); return json({ ok: true });
      }
      if (metodo === 'GET') {
        const mes = q.get('mes') || hoje().slice(0, 7);
        return json({ mes, hoje: hoje(), entregas: db.entregas.filter((e) => e.data.startsWith(mes)).sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id).map((e) => entregaJson(e, u)),
          feriados: db.feriados.filter((f) => f.data.startsWith(mes)) });
      }
      if (metodo === 'POST') {
        if (!pode('gestao')) return erro('Só a supervisão e a coordenação mudam o calendário.', 403);
        const c = resolverConvenio(corpo); if (!c || !corpo.data) return erro('Informe o dia e o convênio.');
        if (db.entregas.some((e) => e.data === corpo.data && e.convenio_id === c.id && e.observacao === (corpo.observacao || ''))) return erro(`${c.nome} já está nesse dia.`, 409);
        const e = { id: novoId(db.entregas), data: corpo.data, convenio_id: c.id, observacao: corpo.observacao || '', concluido: false, concluido_por_id: null };
        db.entregas.push(e); salvar(); return json(entregaJson(e, u));
      }
      const e = db.entregas.find((x) => x.id === Number(r1));
      if (metodo === 'DELETE') { if (!pode('gestao')) return erro('Sem acesso.', 403); db.entregas = db.entregas.filter((x) => x !== e); salvar(); return json({ ok: true }); }
      if (!entregaJson(e, u).pode_concluir) return erro('Só quem cuida desse convênio (ou a gestão) marca como entregue.', 403);
      e.concluido = !!corpo.concluido; e.concluido_por_id = e.concluido ? u.id : null; salvar();
      return json(entregaJson(e, u));
    }

    if (r0 === 'relatorios') {
      const ls = filtroLotes(q, u);
      if (r1 === 'producao') {
        if (!pode('gestao')) return erro('Sem acesso.', 403);
        const por = q.get('por') || 'dia';
        const linhas = agrupar(ls, (l) => `${chaveGrupo(por, l)}|${nome(l.faturista_id)}`).map((g) => {
          const [grupo, faturista] = g.grupo.split('|'); return { grupo, faturista, lotes: g.lotes, guias: g.guias, valor: g.valor };
        });
        return json(linhas.sort((a, b) => b.grupo.localeCompare(a.grupo) || b.valor - a.valor));
      }
      if (r1 === 'csv') {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const corpoCsv = [['Lote', 'Convênio', 'Faturista', 'Competência', 'Data lançamento', 'Guias', 'Valor', 'Status', 'XML'].map(esc).join(';'),
          ...ls.map((l) => [l.numero_lote, conv(l.convenio_id).nome, nome(l.faturista_id), l.competencia, l.data_lancamento.split('-').reverse().join('/'),
            l.qtd_guias, l.valor_total.toFixed(2).replace('.', ','), l.status, xmlDe(l)].map(esc).join(';'))].join('\r\n');
        return new Response('﻿' + corpoCsv, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
      }
      const por = q.get('por') || 'mes';
      const linhas = agrupar(ls, (l) => chaveGrupo(por, l)).map(({ itens, ...r }) => r);
      linhas.sort(['convenio', 'faturista'].includes(por) ? (a, b) => b.valor - a.valor : (a, b) => String(a.grupo).localeCompare(String(b.grupo)));
      return json({ por, totais: somar(ls), linhas });
    }

    if (r0 === 'diretoria') {
      if (!pode('diretoria')) return erro('Sem acesso.', 403);
      const agora = new Date();
      const atual = iso(agora).slice(0, 7);
      const anterior = iso(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)).slice(0, 7);
      const doMes = (m, ate = 31) => somar(db.lotes.filter((l) => l.data_lancamento.startsWith(m) && Number(l.data_lancamento.slice(8)) <= ate));
      const semGrupos = (gs) => gs.map(({ itens, ...r }) => r);
      const pend = db.lotes.filter((l) => xmlDe(l) === 'pendente');
      return json({
        atual, anterior, diaHoje: agora.getDate(), mesAtual: doMes(atual), mesAnterior: doMes(anterior), mesAnteriorAteHoje: doMes(anterior, agora.getDate()),
        evolucao: semGrupos(agrupar(db.lotes, (l) => l.data_lancamento.slice(0, 7))).sort((a, b) => a.grupo.localeCompare(b.grupo)).slice(-12),
        convenios: semGrupos(agrupar(db.lotes.filter((l) => l.data_lancamento.startsWith(String(agora.getFullYear()))), (l) => conv(l.convenio_id).nome)).sort((a, b) => b.valor - a.valor),
        equipe: semGrupos(agrupar(db.lotes.filter((l) => l.data_lancamento.startsWith(atual)), (l) => nome(l.faturista_id))).sort((a, b) => b.valor - a.valor),
        status: semGrupos(agrupar(db.lotes, (l) => l.status)),
        xmlPendentes: { lotes: pend.length, valor: pend.reduce((s, l) => s + l.valor_total, 0) },
      });
    }
    return erro('Rota não encontrada na demonstração.', 404);
  }

  window.fetch = async (entrada, init = {}) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return fetchOriginal(entrada, init);
    await pronto;
    const metodo = (init.method || 'GET').toUpperCase();
    let corpo = {};
    if (init.body instanceof FormData) corpo = init.body;
    else if (typeof init.body === 'string') { try { corpo = JSON.parse(init.body); } catch {} }
    try { return await rota(metodo, url.pathname.slice(i), url.searchParams, corpo); }
    catch (e) { console.error(e); return erro('Erro na demonstração: ' + e.message, 500); }
  };

  // Links de arquivo (PDF do lote, protocolo do XML): só abrem os enviados nesta sessão
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href*="/api/"]');
    if (!a) return;
    ev.preventDefault();
    const m = a.getAttribute('href').match(/\/api\/(lotes|xml)\/(\d+)\/(pdf|arquivo)/);
    const url = m && arquivos[`${m[1] === 'lotes' ? 'lote' : 'xml'}:${m[2]}`];
    if (url) window.open(url, '_blank'); else alert('Na demonstração, só abrem os arquivos enviados nesta visita.');
  }, true);

  // Faixa de aviso + botão para recomeçar
  document.addEventListener('DOMContentLoaded', () => {
    const faixa = document.createElement('div');
    faixa.className = 'faixa-demo';
    faixa.innerHTML = 'Demonstração · dados fictícios · senha do primeiro acesso: <b>123456</b> <button type="button">Recomeçar do zero</button>';
    faixa.querySelector('button').onclick = () => { try { localStorage.removeItem(CHAVE); } catch {} location.href = location.pathname; };
    document.body.append(faixa);
  });
})();
