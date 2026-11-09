// Lê o PDF de protocolo/lote do convênio e devolve os campos do faturamento.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { REGRA_GUIAS } from './config.js';

// Junta os pedaços de texto do PDF em linhas, pela altura (y) e da esquerda para a direita (x).
async function linhasDoPdf(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const { items } = await pagina.getTextContent();
    const grupos = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      // A página pode vir girada: lê na direção do próprio texto.
      const [a, b, , , e, f] = it.transform;
      const n = Math.hypot(a, b) || 1;
      const ux = a / n;
      const uy = b / n;
      const x = e * ux + f * uy; // posição ao longo da linha
      const y = e * uy - f * ux; // qual linha (cresce para baixo)
      let g = grupos.find((g) => Math.abs(g.y - y) < 2.5);
      if (!g) grupos.push((g = { y, itens: [] }));
      g.itens.push({ x, s: it.str.trim() });
    }
    grupos.sort((a, b) => a.y - b.y);
    for (const g of grupos) {
      g.itens.sort((a, b) => a.x - b.x);
      linhas.push(g.itens.map((i) => i.s).join(' '));
    }
  }
  return linhas;
}

export const paraNumero = (txt) => Number(String(txt).replace(/\./g, '').replace(',', '.'));
const DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

export async function extrairLote(buffer) {
  const linhas = await linhasDoPdf(buffer);
  const texto = linhas.join('\n');
  const avisos = [];

  // Lote: "PROTOCOLO: 361843-BRADESCO"
  const prot = texto.match(/PROTOCOLO:\s*(\d+)(?:\s*-\s*([^\s\n]+))?/i);
  const seq = texto.match(/Seq\.?\s*protocolo:\s*\(?(\d+)\)?/i);
  const numeroLote = prot?.[1] || seq?.[1] || '';
  if (!numeroLote) avisos.push('Número do lote não encontrado.');

  // Convênio: linha do tipo "Bradesco Saúde (635902)" no cabeçalho
  let convenioNome = '';
  let convenioCodigo = '';
  let prestador = '';
  const semCabecalho = (l) => (l || '').replace(/(PROTOCOLO|Seq\.?\s*protocolo|Tipo\s*protocolo):.*$/i, '').trim();
  for (let i = 0; i < Math.min(linhas.length, 8); i++) {
    const m = semCabecalho(linhas[i]).match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (m) {
      convenioNome = m[1].trim();
      convenioCodigo = m[2];
      for (let j = i - 1; j >= 0 && !prestador; j--) prestador = semCabecalho(linhas[j]);
      break;
    }
  }
  if (!convenioNome && prot?.[2]) convenioNome = prot[2];
  if (!convenioNome) avisos.push('Convênio não encontrado.');
  const tipo = texto.match(/Tipo\s*protocolo:\s*([^\n]+?)\s*(?:\n|$)/i)?.[1]?.trim() || '';

  // Período: "Período de 31/10/2026 00:00:00 até 31/10/2026 08:20:12"
  const per = texto.match(/Per[ií]odo\s+de\s+(\d{2}\/\d{2}\/\d{4}).*?at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i);
  const isoData = (d) => (d ? d.split('/').reverse().join('-') : '');
  const periodoInicio = isoData(per?.[1]);
  const periodoFim = isoData(per?.[2]);

  // Total: "Total do protocolo 10/10 ... 2.327,79"
  let guiasTexto = '';
  let qtdGuias = 0;
  let valorTotal = 0;
  const iTotal = linhas.findIndex((l) => /Total\s+do\s+protocolo/i.test(l));
  if (iTotal >= 0) {
    const linhaTotal = linhas[iTotal];
    const fr = linhaTotal.match(/(\d+)\s*\/\s*(\d+)/);
    if (fr) {
      guiasTexto = `${fr[1]}/${fr[2]}`;
      const a = Number(fr[1]);
      const b = Number(fr[2]);
      qtdGuias = REGRA_GUIAS === 'menor' ? Math.min(a, b) : Math.max(a, b);
    }
    const valores = (linhaTotal.match(DINHEIRO) || []).map(paraNumero);
    if (valores.length) valorTotal = Math.max(...valores);
  }
  if (!qtdGuias) avisos.push('Quantidade de guias não encontrada.');
  if (!valorTotal) avisos.push('Valor total não encontrado.');

  // Conferência: quantas linhas de guia o PDF lista (atendimento + paciente + nº da guia)
  const guiasListadas = linhas.filter((l) => /^\d{5,}\s+\D{3,}?\s+\d{6,}/.test(l)).length;
  if (guiasListadas && qtdGuias && guiasListadas !== qtdGuias) {
    avisos.push(`O PDF lista ${guiasListadas} guias, mas o total diz ${guiasTexto}. Confira.`);
  }

  // Competência: o "Refer" mais frequente (MM/AA); se não houver, o mês do período
  const contagem = {};
  for (const l of linhas) {
    const m = l.match(/\b\d{9,}\s+(\d{2})\/(\d{2})\b/g);
    if (m) for (const r of m) {
      const [, mm, aa] = r.match(/(\d{2})\/(\d{2})$/);
      if (Number(mm) >= 1 && Number(mm) <= 12) contagem[`20${aa}-${mm}`] = (contagem[`20${aa}-${mm}`] || 0) + 1;
    }
  }
  let competencia = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  if (!competencia && periodoFim) competencia = periodoFim.slice(0, 7);

  return {
    numeroLote, convenioNome, convenioCodigo, prestador, tipo,
    periodoInicio, periodoFim, competencia,
    guiasTexto, qtdGuias, guiasListadas, valorTotal, avisos,
  };
}
