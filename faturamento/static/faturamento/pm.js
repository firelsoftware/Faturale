// Convênio PM (Polícia Militar): correção dos lotes XML TISS (guia SP-SADT) barrados.
// Roda no navegador: o arquivo não sai do computador. Edita o texto byte a byte
// (cada caractere = 1 byte, ISO-8859-1), sem reformatar nem regravar o XML por um parser.

const ISOB = { codigo: '03056609000170', cnes: '7766777' };
const HOB_CNPJ = '00649756000166';
// Consultas de oftalmologia (10101304 a 10101313): o código fica, a tabela é 00
const CONSULTAS_OFTALMO = ['10101304', '10101305', '10101306', '10101307', '10101308', '10101309', '10101310', '10101311', '10101312', '10101313'];
const CONSULTA = '10101012';
const PRONTO_SOCORRO = '10101039';
const CAPSULOTOMIA_TUSS = '30306019';
const CAPSULOTOMIA = '90300240';
const FOTOCOAGULACAO = '90300239';
const PROIBIDO = '41501144';

// ---------- bytes <-> texto (1 caractere por byte, sem perder nada) ----------
export function bytesParaTexto(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}
export function textoParaBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}

// ---------- MD5 ----------
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
export function md5(bytes) {
  const len = bytes.length;
  const blocos = ((len + 8) >> 6) + 1;
  const w = new Int32Array(blocos * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8);
  w[blocos * 16 - 2] = (len * 8) >>> 0;
  w[blocos * 16 - 1] = Math.floor(len / 0x20000000);
  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  for (let o = 0; o < w.length; o += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + w[o + g]) | 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      A = D; D = C; C = B;
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0].map((x) => {
    let h = '';
    for (let i = 0; i < 4; i++) h += ((x >>> (i * 8)) & 255).toString(16).padStart(2, '0');
    return h;
  }).join('');
}

// Hash TISS: MD5 do texto de todos os elementos, na ordem, sem espaços nas pontas,
// sem o ans:hash e sem a declaração <?xml ...?>.
const PONTAS = /^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g;
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const tirarEntidades = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENTIDADES[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n < 256 ? String.fromCharCode(n) : m;
});
function utf8ParaLatin1(s) {
  try {
    const u = new TextDecoder('utf-8', { fatal: true }).decode(textoParaBytes(s));
    return [...u].every((c) => c.charCodeAt(0) < 256) ? u : null;
  } catch { return null; }
}
const latin1ParaUtf8 = (s) => bytesParaTexto(new TextEncoder().encode(s));
// Formas de calcular o hash que os sistemas de origem usam. 'bytes' é a da ANS.
export const MODOS_HASH = ['bytes', 'utf8', 'latin1', 'entidades', 'utf8+entidades'];
export function hashTiss(texto, modo = 'bytes') {
  const corpo = texto.replace(/<ans:hash>[\s\S]*?<\/ans:hash>/g, '').replace(/<\?xml[\s\S]*?\?>/g, '');
  let junto = '';
  for (const m of corpo.matchAll(/>([^<]*)</g)) junto += m[1].replace(PONTAS, '');
  if (modo.includes('entidades')) junto = tirarEntidades(junto);
  if (modo.startsWith('utf8')) junto = utf8ParaLatin1(junto) ?? junto;
  if (modo === 'latin1') junto = latin1ParaUtf8(junto);
  return md5(textoParaBytes(junto));
}

// ---------- utilidades ----------
const tag = (bloco, nome) => {
  const m = bloco.match(new RegExp(`<ans:${nome}>([^<]*)</ans:${nome}>`));
  return m ? m[1].trim() : null;
};
const centavos = (v) => Math.round(parseFloat(v || '0') * 100);
const somaValorTotalGeral = (t) => [...t.matchAll(/<ans:valorTotalGeral>\s*([\d.]+)\s*<\/ans:valorTotalGeral>/g)].reduce((s, m) => s + centavos(m[1]), 0);
function trocaValor(bloco, nome, novo) {
  return bloco.replace(new RegExp(`(<ans:${nome}>)([^<]*)(</ans:${nome}>)`), (_, a, v, b) => {
    const ini = v.match(/^\s*/)[0], fim = v.match(/\s*$/)[0];
    return `${a}${ini}${novo}${fim}${b}`;
  });
}

export function detectarUnidade(texto) {
  const origem = (texto.match(/<ans:origem>[\s\S]*?<\/ans:origem>/) || [''])[0];
  if (origem.includes(HOB_CNPJ)) return 'HOB';
  if (origem.includes(ISOB.codigo)) return 'ISOB';
  return '';
}

// ---------- correção ----------
// unidadeEscolhida: 'ISOB', 'HOB' ou '' (pelo CNPJ da origem)
export function corrigirPm(bytes, nomeArquivo, unidadeEscolhida = '') {
  let t = bytesParaTexto(bytes);
  const original = t;
  const r = {
    arquivo: nomeArquivo, numeroLote: tag(t, 'numeroLote') || '', padrao: tag(t, 'Padrao') || tag(t, 'versaoPadrao') || '',
    guias: 0, valorAntes: 0, valorDepois: 0,
    contagem: { pacote98: 0, consulta: 0, senha: 0, tipoAtendimento: 0, duplicadas: 0, viaAcesso: 0, capsulotomia: 0, executante: 0 },
    alteracoes: [], avisosA: [], avisosB: [], avisosC: [], observacoes: [],
    unidade: '', unidadeOrigem: '', hashAntigo: '', hashNovo: '', hashModo: 'bytes', hashConfere: false, bloqueado: false, travado: false, xml: null,
  };
  const C = (guia, texto) => r.avisosC.push({ guia, texto });
  const obs = (guia, texto) => r.observacoes.push({ guia, texto });
  const mudou = (guia, regra, texto) => r.alteracoes.push({ guia, regra, texto });

  if (!/<ans:mensagemTISS[\s>]/.test(t)) {
    C('—', 'O arquivo não parece um XML TISS da ANS (não tem ans:mensagemTISS).');
    r.bloqueado = r.travado = true;
    return r;
  }

  // Hash original: a função tem que reproduzir o que veio no arquivo
  const hashTag = t.match(/<ans:hash>([^<]*)<\/ans:hash>/);
  r.hashAntigo = hashTag ? hashTag[1].trim() : '';
  if (!hashTag) C('—', 'O arquivo não tem a tag ans:hash.');
  else {
    const modo = MODOS_HASH.find((m) => hashTiss(original, m) === r.hashAntigo.toLowerCase());
    r.hashConfere = !!modo;
    r.hashModo = modo || 'bytes';
    if (!modo) C('—', 'O hash que veio no arquivo não bate com o cálculo padrão da ANS (o sistema de origem pode ter calculado errado). O hash novo foi calculado pelo padrão da ANS.');
    else if (modo !== 'bytes') obs('—', `Hash original calculado no formato "${modo}"; o novo foi calculado do mesmo jeito.`);
  }

  // Unidade
  r.unidadeOrigem = detectarUnidade(t);
  r.unidade = unidadeEscolhida || r.unidadeOrigem;
  if (!r.unidade) C('—', 'Não deu para saber a unidade (ISOB ou HOB) pelo CNPJ da origem. Escolha a unidade e jogue o arquivo de novo.');
  else if (!unidadeEscolhida) obs('—', `Unidade ${r.unidade} identificada pelo CNPJ da origem. Confirme.`);
  else if (r.unidadeOrigem && r.unidadeOrigem !== unidadeEscolhida) obs('—', `Você escolheu ${unidadeEscolhida}, mas o CNPJ da origem é do ${r.unidadeOrigem}. Confira.`);
  const padraoEsperado = { ISOB: '4.01.00', HOB: '3.05.00' }[r.unidade];
  if (padraoEsperado && r.padrao && r.padrao !== padraoEsperado) obs('—', `Padrão TISS ${r.padrao}; o esperado para ${r.unidade} é ${padraoEsperado}.`);

  // 41501144 fora das guias (o resto é apontado guia por guia)
  const foraDasGuias = t.replace(/<ans:guiaSP-SADT>[\s\S]*?<\/ans:guiaSP-SADT>/g, '');
  if (foraDasGuias.includes(PROIBIDO)) r.avisosA.push({ guia: '—', texto: `${PROIBIDO} aparece fora das guias.` });

  // Números de guia: todos, para a regra das duplicadas não criar outra repetição
  const todosNumeros = new Set([...t.matchAll(/<ans:numeroGuiaPrestador>\s*([^<\s]*)/g)].map((m) => m[1]));
  const vistos = new Set();
  const cobrancas = {};
  const nl = t.includes('\r\n') ? '\r\n' : '\n';

  t = t.replace(/<ans:guiaSP-SADT>[\s\S]*?<\/ans:guiaSP-SADT>/g, (guiaXml) => {
    r.guias++;
    let g = guiaXml;
    let numero = tag(g, 'numeroGuiaPrestador') || `guia ${r.guias}`;
    const carteira = tag(g, 'numeroCarteira');

    // 8. Guia repetida no lote: põe 0 na frente
    if (vistos.has(numero)) {
      let novo = `0${numero}`;
      while (todosNumeros.has(novo) || vistos.has(novo)) novo = `0${novo}`;
      g = g.replace(/(<ans:cabecalhoGuia>[\s\S]*?<ans:numeroGuiaPrestador>\s*)([^<\s]*)/, (_, a) => `${a}${novo}`);
      mudou(novo, 'duplicadas', `Guia ${numero} repetida no lote: virou ${novo}`);
      r.contagem.duplicadas++;
      numero = novo;
    }
    vistos.add(numero);

    if (carteira === null || carteira === '') obs(numero, 'numeroCarteira vazio.');
    if (guiaXml.includes(PROIBIDO)) {
      const naDescricao = [...guiaXml.matchAll(/<ans:descricaoProcedimento>([^<]*)<\/ans:descricaoProcedimento>/g)].some((m) => m[1].includes(PROIBIDO));
      r.avisosA.push({ guia: numero, texto: naDescricao ? `${PROIBIDO} aparece na descrição de um procedimento. Diga se pode mandar.` : `Código ${PROIBIDO} na guia. Ele não deveria estar lá.` });
    }

    // 1. tipoAtendimento 11 -> 04
    g = g.replace(/(<ans:tipoAtendimento>\s*)11(\s*<\/ans:tipoAtendimento>)/g, (_, a, b) => {
      r.contagem.tipoAtendimento++;
      mudou(numero, 'tipoAtendimento', 'tipoAtendimento 11 → 04');
      return `${a}04${b}`;
    });

    let temConsulta = false, temCapsulotomia = false, procedimentos = 0;
    g = g.replace(/<ans:procedimentoExecutado>[\s\S]*?<\/ans:procedimentoExecutado>/g, (procXml) => {
      procedimentos++;
      let p = procXml;
      let codigo = tag(p, 'codigoProcedimento');
      const tabela = tag(p, 'codigoTabela');
      const descricao = tag(p, 'descricaoProcedimento') || '';
      const qtd = tag(p, 'quantidadeExecutada') || '';
      const valor = tag(p, 'valorTotal') || '';
      const data = tag(p, 'dataExecucao') || '';
      if (!codigo) { C(numero, 'Procedimento sem codigoProcedimento.'); return p; }

      const chave = `${carteira}|${codigo}|${data}`;
      (cobrancas[chave] ||= []).push(numero);

      if (codigo === PROIBIDO) return p; // já avisado (A)

      // 3. Consulta de oftalmologia: o código fica, tabela 00
      if (CONSULTAS_OFTALMO.includes(codigo)) {
        if (tabela !== '00') {
          p = trocaValor(p, 'codigoTabela', '00');
          r.contagem.consulta++;
          mudou(numero, 'consulta', `Consulta ${codigo}: tabela ${tabela} → 00`);
        }
        return p;
      }
      // Consulta 10101012: tabela 22 e a guia fica sem senha
      if (codigo === CONSULTA) {
        temConsulta = true;
        if (tabela !== '22') {
          p = trocaValor(p, 'codigoTabela', '22');
          r.contagem.consulta++;
          mudou(numero, 'consulta', `Consulta ${codigo}: tabela ${tabela} → 22`);
        }
        return p;
      }
      // 4. Pronto-socorro: não mexer
      if (codigo === PRONTO_SOCORRO) {
        if (tabela !== '22') C(numero, `Pronto-socorro ${codigo} veio com tabela ${tabela} (esperado 22). Mantido como veio.`);
        return p;
      }
      // 6. Capsulotomia YAG na ISOB -> 90300240, tabela 98
      if (codigo === CAPSULOTOMIA_TUSS) {
        if (r.unidade !== 'ISOB') { C(numero, `Capsulotomia ${codigo} fora da ISOB: não há regra. Mantido como veio.`); return p; }
        p = trocaValor(trocaValor(p, 'codigoProcedimento', CAPSULOTOMIA), 'codigoTabela', '98');
        r.contagem.capsulotomia++;
        mudou(numero, 'capsulotomia', `Capsulotomia ${codigo} (tab. ${tabela}) → ${CAPSULOTOMIA} (tab. 98)`);
        codigo = CAPSULOTOMIA;
      }
      // 2. Pacote: tabela 98
      if (codigo.startsWith('9')) {
        const tabAtual = tag(p, 'codigoTabela');
        if (tabAtual !== '98') {
          p = trocaValor(p, 'codigoTabela', '98');
          r.contagem.pacote98++;
          mudou(numero, 'pacote98', `Pacote ${codigo}: tabela ${tabAtual} → 98`);
        }
        // 7. Capsulotomia e fotocoagulação: via de acesso e técnica
        if (codigo === CAPSULOTOMIA || codigo === FOTOCOAGULACAO) {
          if (codigo === CAPSULOTOMIA) temCapsulotomia = true;
          const temVia = p.includes('<ans:viaAcesso>'), temTec = p.includes('<ans:tecnicaUtilizada>');
          if (temVia && temTec) return p;
          if (temVia || temTec) { C(numero, `${codigo}: já tem só uma das tags viaAcesso / tecnicaUtilizada. Mantido como veio.`); return p; }
          const fim = '</ans:quantidadeExecutada>';
          const pos = p.indexOf(fim);
          if (pos < 0) { C(numero, `${codigo} sem quantidadeExecutada: não deu para incluir a via de acesso.`); return p; }
          const depois = pos + fim.length;
          const linha = p.slice(0, pos).split(/\r?\n/).pop();
          const recuo = linha.match(/^[ \t]*/)[0];
          const quebra = /^\r?\n/.test(p.slice(depois));
          const novo = quebra
            ? `${nl}${recuo}<ans:viaAcesso>1</ans:viaAcesso>${nl}${recuo}<ans:tecnicaUtilizada>1</ans:tecnicaUtilizada>`
            : '<ans:viaAcesso>1</ans:viaAcesso><ans:tecnicaUtilizada>1</ans:tecnicaUtilizada>';
          p = p.slice(0, depois) + novo + p.slice(depois);
          r.contagem.viaAcesso++;
          mudou(numero, 'viaAcesso', `${codigo}: incluídas viaAcesso 1 e tecnicaUtilizada 1`);
        }
        return p;
      }
      // B. Exame aberto com código TUSS (tabela 22)  /  C. qualquer outra coisa
      if (tabela === '22') r.avisosB.push({ guia: numero, codigo, descricao, qtd, valor });
      else C(numero, `Código ${codigo} (tabela ${tabela}) não está coberto pelas regras. Mantido como veio.`);
      return p;
    });

    if (temCapsulotomia && procedimentos > 1) obs(numero, 'Capsulotomia numa guia com outros procedimentos.');

    // 5. Guia com consulta: apaga a tag senha inteira
    const temSenha = /<ans:senha>\s*[^<\s][^<]*<\/ans:senha>/.test(guiaXml);
    if (temConsulta) {
      g = g.replace(/(\r?\n[ \t]*)?<ans:senha>[^<]*<\/ans:senha>|(\r?\n[ \t]*)?<ans:senha\s*\/>/g, () => {
        r.contagem.senha++;
        mudou(numero, 'senha', 'Tag senha removida (guia de consulta)');
        return '';
      });
    } else if (!temSenha) obs(numero, 'Guia sem senha na origem.');

    // 9. Executante conforme a unidade
    const exec = g.match(/<ans:dadosExecutante>[\s\S]*?<\/ans:dadosExecutante>/) || g.match(/<ans:contratadoExecutante>[\s\S]*?<\/ans:contratadoExecutante>/);
    if (!exec) C(numero, 'Guia sem ans:contratadoExecutante.');
    else if (r.unidade) {
      let e = exec[0];
      const antes = e;
      if (r.unidade === 'ISOB') {
        const id = e.match(/<ans:(codigoPrestadorNaOperadora|cnpjContratado|cpfContratado)>([^<]*)<\/ans:\1>/);
        if (!id) C(numero, 'Executante sem código/CNPJ do prestador.');
        else if (id[1] !== 'codigoPrestadorNaOperadora' || id[2].trim() !== ISOB.codigo) {
          e = e.replace(id[0], `<ans:codigoPrestadorNaOperadora>${ISOB.codigo}</ans:codigoPrestadorNaOperadora>`);
        }
        if (!/<ans:CNES>/.test(e)) C(numero, 'Executante sem CNES.');
        else if (tag(e, 'CNES') !== ISOB.cnes) e = trocaValor(e, 'CNES', ISOB.cnes);
      } else {
        const cnpj = tag(e, 'cnpjContratado');
        if (cnpj === null) C(numero, 'Executante do HOB sem cnpjContratado.');
        else if (cnpj !== HOB_CNPJ) e = trocaValor(e, 'cnpjContratado', HOB_CNPJ);
      }
      if (e !== antes) {
        g = g.replace(antes, e);
        r.contagem.executante++;
        mudou(numero, 'executante', `Executante ajustado para ${r.unidade}`);
      }
    }
    return g;
  });

  // Procedimento que parece cobrado em dobro (mesma carteira, código e data)
  for (const [chave, guias] of Object.entries(cobrancas)) {
    if (guias.length > 1) {
      const [, codigo, data] = chave.split('|');
      obs(guias.join(', '), `Código ${codigo} cobrado ${guias.length}x para a mesma carteira${data ? ` em ${data.split('-').reverse().join('/')}` : ''}.`);
    }
  }

  // Rede de segurança: nada pode passar sem ser lido
  if (!r.guias) C('—', 'Nenhuma guia SP-SADT (ans:guiaSP-SADT) no arquivo: nada foi corrigido.');
  const outrasGuias = [...new Set([...t.matchAll(/<ans:(guia(?!SP-SADT\b)[A-Za-z-]*)>/g)].map((m) => m[1]))]
    .filter((n) => !['guiaPrincipal', 'guiasTISS'].includes(n));
  if (outrasGuias.length) C('—', `O lote tem guias de outro tipo (${outrasGuias.join(', ')}). Elas não foram corrigidas.`);
  const naoLidos = t.replace(/<ans:procedimentoExecutado>[\s\S]*?<\/ans:procedimentoExecutado>/g, '').replace(/<ans:outrasDespesas>[\s\S]*?<\/ans:outrasDespesas>/g, '');
  for (const m of naoLidos.matchAll(/<ans:codigoProcedimento>\s*([^<\s]*)/g)) {
    C('—', `Código ${m[1]} está fora de ans:procedimentoExecutado e não foi corrigido.`);
  }

  // Conferência
  r.valorAntes = somaValorTotalGeral(original) / 100;
  r.valorDepois = somaValorTotalGeral(t) / 100;
  if (r.valorAntes !== r.valorDepois) { C('—', 'O total do lote mudou depois da correção. Arquivo não liberado.'); r.travado = true; }
  if (hashTag) {
    let novo = hashTiss(t, r.hashModo);
    if (/[A-F]/.test(r.hashAntigo) && !/[a-f]/.test(r.hashAntigo)) novo = novo.toUpperCase();
    t = t.replace(/(<ans:hash>\s*)[^<\s]*/, (_, a) => `${a}${novo}`);
    r.hashNovo = novo;
    if (hashTiss(t, r.hashModo) !== novo.toLowerCase()) { C('—', 'O hash novo não confere com o conteúdo final.'); r.travado = true; }
  }
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) { C('—', 'O XML corrigido não ficou bem formado.'); r.travado = true; }
  }

  r.bloqueado = !!(r.avisosA.length || r.avisosB.length || r.avisosC.length);
  r.nomeSaida = `${nomeArquivo.replace(/\.xml$/i, '')}_corrigido.xml`; // mesmo nome do arquivo enviado
  r.xml = textoParaBytes(t);
  return r;
}
