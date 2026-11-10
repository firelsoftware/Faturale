"""Prazo do portal de cada convênio. Três formatos (e um texto livre para o resto):

- intervalo: de X a Y            ("1 à 7")
- dias:      dias específicos    ("9 e 27", "3, 4 e 10")
- dia_util:  até o Nº dia útil   ("até o 5º dia útil")
- livre:     só o texto          ("diário até as 17h")
"""
import re
from datetime import date, timedelta

TIPOS = {'intervalo': 'De … a …', 'dias': 'Dias específicos', 'dia_util': 'Até o Nº dia útil', 'livre': 'Outro (texto)'}


def ler_dias(texto):
    """'9, 27' / '9 e 27' → [9, 27] (só 1 a 31, sem repetir, em ordem)."""
    return sorted({int(n) for n in re.findall(r'\d+', str(texto or '')) if 1 <= int(n) <= 31})


def descrever(tipo, inicio=None, fim=None, dias=None, dia_util=None, hora='', livre=''):
    if tipo == 'intervalo' and inicio and fim:
        base = f'{inicio} a {fim}'
    elif tipo == 'dias' and dias:
        lista = [str(d) for d in dias]
        base = lista[0] if len(lista) == 1 else f"{', '.join(lista[:-1])} e {lista[-1]}"
    elif tipo == 'dia_util' and dia_util:
        base = f'até o {dia_util}º dia útil'
    else:
        base = (livre or '').strip()
    hora = (hora or '').strip()
    return f'{base}, até as {hora}' if base and hora and tipo != 'livre' else base


def dia_util_do_mes(dia: date, feriados=()):
    """Quantos dias úteis (seg–sex, fora feriados) do mês já passaram até 'dia', contando ele.
    Devolve 0 se 'dia' não for útil."""
    if dia.weekday() >= 5 or dia in feriados:
        return 0
    n, d = 0, dia.replace(day=1)
    while d <= dia:
        if d.weekday() < 5 and d not in feriados:
            n += 1
        d += timedelta(days=1)
    return n


def aberto(tipo, dia: date, inicio=None, fim=None, dias=None, dia_util=None, feriados=()):
    if tipo == 'intervalo':
        return bool(inicio and fim and inicio <= dia.day <= fim)
    if tipo == 'dias':
        return dia.day in (dias or [])
    if tipo == 'dia_util':
        n = dia_util_do_mes(dia, feriados)
        return bool(dia_util and 0 < n <= dia_util)
    return False


def interpretar(texto):
    """Converte o texto antigo ("1 à 7", "9 e 27", "até o 5º dia útil") nos campos novos."""
    t = (texto or '').strip()
    hora = ''
    m = re.search(r',?\s*at[ée] (?:as|às) (\d{1,2}h\w*)', t, re.I)
    if m and not re.match(r'^\s*at[ée] (?:as|às)', t, re.I):
        hora, t = m.group(1), t[:m.start()].strip()
    if m := re.fullmatch(r'(\d{1,2})\s*(?:à|a|-|até)\s*(\d{1,2})', t, re.I):
        return {'tipo': 'intervalo', 'inicio': int(m.group(1)), 'fim': int(m.group(2)), 'hora': hora}
    if re.fullmatch(r'\d{1,2}(?:\s*(?:,|e)\s*\d{1,2})+', t, re.I):
        return {'tipo': 'dias', 'dias': ler_dias(t), 'hora': hora}
    if m := re.search(r'(?:at[ée] o\s*)?(\d{1,2})\s*[º°o]?\s*dia [úu]til', t, re.I):
        return {'tipo': 'dia_util', 'dia_util': int(m.group(1)), 'hora': hora}
    return {'tipo': 'livre', 'livre': texto or ''}
