"""Leitura do PDF de protocolo/lote do convênio (modelo FatAct_R1).

Devolve número do lote, convênio, guias, valor, competência e período.
"""
import io
import math
import re
from collections import Counter
from decimal import Decimal

from django.conf import settings
from pypdf import PdfReader


def _mult(m, n):
    return [
        m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
    ]


def linhas_do_pdf(dados: bytes) -> list[str]:
    """Junta os pedaços de texto em linhas, seguindo a direção do próprio texto
    (a página do relatório vem girada 90°)."""
    leitor = PdfReader(io.BytesIO(dados))
    linhas = []
    for pagina in leitor.pages:
        pedacos = []

        def visitor(texto, cm, tm, _fonte, _tamanho):
            if not texto or not texto.strip():
                return
            a, b, _, _, e, f = _mult(tm, cm)
            n = math.hypot(a, b) or 1
            ux, uy = a / n, b / n
            pedacos.append((e * uy - f * ux, e * ux + f * uy, texto.strip()))

        pagina.extract_text(visitor_text=visitor)
        grupos = []  # [y, [(x, texto)]]
        for y, x, texto in pedacos:
            for g in grupos:
                if abs(g[0] - y) < 2.5:
                    g[1].append((x, texto))
                    break
            else:
                grupos.append([y, [(x, texto)]])
        for _, itens in sorted(grupos, key=lambda g: g[0]):
            linhas.append(' '.join(t for _, t in sorted(itens)))
    return linhas


def para_decimal(txt: str) -> Decimal:
    return Decimal(txt.replace('.', '').replace(',', '.'))


DINHEIRO = re.compile(r'\d{1,3}(?:\.\d{3})*,\d{2}')
CABECALHO = re.compile(r'(PROTOCOLO|Seq\.?\s*protocolo|Tipo\s*protocolo):.*$', re.I)


def analisar(linhas: list[str]) -> dict:
    texto = '\n'.join(linhas)
    avisos = []

    # Lote: "PROTOCOLO: 361843-BRADESCO" ou "PROTOCOLO: 365118Larissa"
    prot = re.search(r'PROTOCOLO:\s*(\d+)(?:\s*(-)?\s*([^\s\d][^\s]*))?', texto, re.I)
    seq = re.search(r'Seq\.?\s*protocolo:\s*\(?(\d+)\)?', texto, re.I)
    numero_lote = (prot and prot.group(1)) or (seq and seq.group(1)) or ''
    if not numero_lote:
        avisos.append('Número do lote não encontrado.')

    # Convênio: "Bradesco Saúde (635902)"; o prestador vem na linha acima
    convenio_nome = convenio_codigo = prestador = ''
    for i, linha in enumerate(linhas[:8]):
        m = re.match(r'^(.+?)\s*\((\d+)\)\s*$', CABECALHO.sub('', linha).strip())
        if m:
            convenio_nome, convenio_codigo = m.group(1).strip(), m.group(2)
            for j in range(i - 1, -1, -1):
                prestador = CABECALHO.sub('', linhas[j]).strip()
                if prestador:
                    break
            break
    if not convenio_nome and prot and prot.group(2) and prot.group(3):
        convenio_nome = prot.group(3)
    if not convenio_nome:
        avisos.append('Convênio não encontrado.')

    # Quem gerou: o login do rodapé ("emmily.trindade  FatAct_R1")…
    usuario_rodape = ''
    for l in reversed(linhas[-6:]):
        m = re.search(r'\b([a-z][\w-]*\.[a-z][\w.-]*)\b', l, re.I) or re.search(r'\b([a-z][\w.-]*)\s+FatAct_\w+', l, re.I)
        if m and not re.match(r'FatAct', m.group(1), re.I):
            usuario_rodape = m.group(1)
            break
    # …mas um nome colado no protocolo lá em cima ("365118Larissa") vale mais.
    # Quem decide se é pessoa ou convênio ("-BRADESCO") é a view, que conhece a equipe.
    sufixo_protocolo = prot.group(3) if prot and prot.group(3) else ''
    sufixo_com_hifen = bool(prot and prot.group(2))

    tipo = re.search(r'Tipo\s*protocolo:\s*([^\n]+?)\s*(?:\n|$)', texto, re.I)
    per = re.search(r'Per[ií]odo\s+de\s+(\d{2}/\d{2}/\d{4}).*?at[ée]\s+(\d{2}/\d{2}/\d{4})', texto, re.I)
    iso = lambda d: '-'.join(reversed(d.split('/'))) if d else ''
    periodo_inicio = iso(per.group(1)) if per else ''
    periodo_fim = iso(per.group(2)) if per else ''

    # Total: "Total do protocolo 10/10 ... 2.327,79"
    guias_texto, qtd_guias, valor_total = '', 0, Decimal('0')
    linha_total = next((l for l in linhas if re.search(r'Total\s+do\s+protocolo', l, re.I)), '')
    fr = re.search(r'(\d+)\s*/\s*(\d+)', linha_total)
    if fr:
        a, b = int(fr.group(1)), int(fr.group(2))
        guias_texto = f'{a}/{b}'
        qtd_guias = min(a, b) if settings.FATURALE_REGRA_GUIAS == 'menor' else max(a, b)
    valores = [para_decimal(v) for v in DINHEIRO.findall(linha_total)]
    if valores:
        valor_total = max(valores)
    if not qtd_guias:
        avisos.append('Quantidade de guias não encontrada.')
    if not valor_total:
        avisos.append('Valor total não encontrado.')

    # Conferência: linhas de guia listadas (atendimento + paciente + nº da guia)
    guias_listadas = sum(1 for l in linhas if re.match(r'^\d{5,}\s+\D{3,}?\s+\d{6,}', l))
    if guias_listadas and qtd_guias and guias_listadas != qtd_guias:
        avisos.append(f'O PDF lista {guias_listadas} guias, mas o total diz {guias_texto}. Confira.')

    # Competência: o "Refer" (MM/AA) mais frequente; senão, o mês do período
    refs = Counter()
    for l in linhas:
        for mm, aa in re.findall(r'\b\d{9,}\s+(\d{2})/(\d{2})\b', l):
            if 1 <= int(mm) <= 12:
                refs[f'20{aa}-{mm}'] += 1
    competencia = refs.most_common(1)[0][0] if refs else (periodo_fim[:7] if periodo_fim else '')

    return {
        'numeroLote': numero_lote, 'convenioNome': convenio_nome, 'convenioCodigo': convenio_codigo,
        'prestador': prestador, 'tipo': tipo.group(1).strip() if tipo else '',
        'periodoInicio': periodo_inicio, 'periodoFim': periodo_fim, 'competencia': competencia,
        'guiasTexto': guias_texto, 'qtdGuias': qtd_guias, 'guiasListadas': guias_listadas,
        'valorTotal': float(valor_total), 'avisos': avisos,
        'usuarioRodape': usuario_rodape, 'sufixoProtocolo': sufixo_protocolo, 'sufixoComHifen': sufixo_com_hifen,
    }


# ---------- OCR (PDF escaneado ou foto do protocolo) ----------
_motor_ocr = None


def _ocr():
    global _motor_ocr
    if _motor_ocr is None:
        from rapidocr import RapidOCR  # carrega só quando precisa (leva ~3 s na primeira vez)
        _motor_ocr = RapidOCR()
    return _motor_ocr


def linhas_por_ocr(imagem) -> list[str]:
    """Lê uma imagem (PIL) e monta as linhas pela altura de cada trecho."""
    import numpy as np
    r = _ocr()(np.array(imagem.convert('RGB')))
    if not r.txts:
        return []
    trechos = []
    for caixa, texto in zip(r.boxes, r.txts):
        ys = [p[1] for p in caixa]
        trechos.append((sum(ys) / 4, min(p[0] for p in caixa), max(ys) - min(ys), texto))
    altura = sorted(t[2] for t in trechos)[len(trechos) // 2] or 10
    grupos = []
    for y, x, _, texto in sorted(trechos):
        if grupos and abs(grupos[-1][0] - y) < altura * 0.6:
            grupos[-1][1].append((x, texto))
        else:
            grupos.append([y, [(x, texto)]])
    return [' '.join(t for _, t in sorted(itens)) for _, itens in grupos]


def imagens_do_pdf(dados: bytes):
    """Imagens das páginas de um PDF escaneado, já desviradas."""
    leitor = PdfReader(io.BytesIO(dados))
    for pagina in leitor.pages:
        maior = max(pagina.images, key=lambda i: i.image.width * i.image.height, default=None)
        if maior is not None:
            img = maior.image
            giro = (pagina.get('/Rotate') or 0) % 360
            yield img.rotate(-giro, expand=True) if giro else img


def ler_linhas(dados: bytes, nome_arquivo: str = '') -> tuple[list[str], str]:
    """Texto do PDF quando existe; OCR quando o PDF é escaneado ou o arquivo é foto.
    Devolve (linhas, 'texto' | 'ocr')."""
    if dados[:5] == b'%PDF-':
        linhas = linhas_do_pdf(dados)
        if len(''.join(linhas)) >= 40:
            return linhas, 'texto'
        linhas = []
        for img in imagens_do_pdf(dados):
            linhas += linhas_por_ocr(img)
        return linhas, 'ocr'
    from PIL import Image
    return linhas_por_ocr(Image.open(io.BytesIO(dados))), 'ocr'


def extrair_lote(dados: bytes, nome_arquivo: str = '') -> dict:
    linhas, metodo = ler_linhas(dados, nome_arquivo)
    return {**analisar(linhas), 'leitura': metodo}


def ler_protocolo_xml(dados: bytes, nome_arquivo: str) -> dict:
    """Lê o protocolo que o pessoal do XML anexa. Pode ser o próprio PDF do lote,
    o comprovante do portal (PDF) ou o arquivo XML do TISS.
    Devolve o que achou + todos os números do texto, para procurar o lote."""
    achado = {'tipo': 'outro', 'numeroLote': '', 'convenioNome': '', 'convenioCodigo': '', 'protocolo': '', 'numeros': [], 'valor': None}
    texto = ''
    ehimagem = nome_arquivo.lower().endswith(('.png', '.jpg', '.jpeg'))
    if dados[:5] == b'%PDF-' or ehimagem:
        linhas, metodo = ler_linhas(dados, nome_arquivo)
        achado['tipo'] = 'pdf' if metodo == 'texto' else 'ocr'
        texto = '\n'.join(linhas)
        d = analisar(linhas)
        achado.update(numeroLote=d['numeroLote'], convenioNome=d['convenioNome'], convenioCodigo=d['convenioCodigo'],
                      qtdGuias=d['qtdGuias'], guiasTexto=d['guiasTexto'], competencia=d['competencia'],
                      periodoInicio=d['periodoInicio'], periodoFim=d['periodoFim'], tipoProtocolo=d['tipo'], prestador=d['prestador'],
                      usuarioRodape=d['usuarioRodape'], sufixoProtocolo=d['sufixoProtocolo'], sufixoComHifen=d['sufixoComHifen'])
        m = re.search(r'protocolo\s*(?:n[º°o.]*|de envio|do portal)?\s*[:\-]?\s*(\d{4,})', texto, re.I)
        if m and m.group(1) != d['numeroLote']:
            achado['protocolo'] = m.group(1)
        achado['valor'] = valor_do_texto(linhas, d['valorTotal'])
    elif nome_arquivo.lower().endswith('.xml') or dados.lstrip()[:1] == b'<':
        achado['tipo'] = 'xml'
        texto = dados.decode('utf-8', errors='ignore')
        tag = lambda nome: (re.search(rf'<(?:\w+:)?{nome}>\s*([^<\s]+)', texto) or [None, ''])[1]
        achado.update(numeroLote=tag('numeroLote'), protocolo=tag('numeroProtocolo'), convenioCodigo=tag('registroANS'))
        achado['valor'] = valor_do_xml(texto)
    achado['numeros'] = sorted(set(re.findall(r'\b\d{4,12}\b', texto)))
    return achado


def valor_do_texto(linhas, valor_total_protocolo=0):
    """Valor total do protocolo do convênio (PDF/foto). Ordem de preferência:
    linha "Total do protocolo"; linha com "valor total"/"total geral"/"total"; maior valor do documento."""
    if valor_total_protocolo:
        return float(valor_total_protocolo)
    for padrao in (r'valor\s+total|total\s+geral|valor\s+do\s+lote|valor\s+apresentado', r'\btotal\b'):
        for l in reversed(linhas):
            if re.search(padrao, l, re.I):
                vals = [para_decimal(v) for v in DINHEIRO.findall(l)]
                if vals:
                    return float(max(vals))
    todos = [para_decimal(v) for l in linhas for v in DINHEIRO.findall(l)]
    return float(max(todos)) if todos else None


def valor_do_xml(texto):
    """XML do TISS: soma dos valorTotalGeral das guias (ou o valor total do lote, se houver)."""
    def numeros(tag):
        return [Decimal(v) for v in re.findall(rf'<(?:\w+:)?{tag}>\s*([\d.]+)\s*<', texto)]
    for tag in ('valorTotalLote', 'valorTotalProtocolo'):
        v = numeros(tag)
        if v:
            return float(v[0])
    v = numeros('valorTotalGeral')
    return float(sum(v)) if v else None
