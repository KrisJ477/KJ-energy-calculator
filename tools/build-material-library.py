#!/usr/bin/env python3
"""Generate data/materials.json from data/materialbibliotek-TEMP.md (SPEC 3.8).

The library file is the shared material library every project loads. This script copies the
values and their sources from the temporary markdown draft without retyping any number.
Run: python3 tools/build-material-library.py
"""
import json, re, unicodedata, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'materialbibliotek-TEMP.md')
OUT = os.path.join(ROOT, 'data', 'materials.json')

text = open(SRC, encoding='utf-8').read()

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s[:60]

def strip_md(s):
    return re.sub(r'\*\*', '', s).strip()

NUM = re.compile(r'(\d+(?:[.,]\d+)?)')

def first_number(s):
    m = NUM.search(s)
    return float(m.group(1).replace(',', '.')) if m else None

def certainty(s):
    m = re.search(r'\[(S\?|S|E)\]', s)
    return m.group(1) if m else None

def parse_tables():
    """Yield (section_title, header, rows) for every markdown table."""
    lines = text.split('\n')
    section = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('#'):
            section = line.lstrip('#').strip()
        if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[-| ]+\|$', lines[i + 1].strip()):
            header = [strip_md(c) for c in line.strip().strip('|').split('|')]
            rows = []
            i += 2
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                rows.append(cells)
                i += 1
            yield section, header, rows
            continue
        i += 1

materials = []
opening_defaults = []
construction_examples = []
surface = {}
air_gaps = []
attic = []
seen = set()

for section, header, rows in parse_tables():
    h0 = header[0]
    if h0 == 'Namn (sv)' and 'λ W/(m·K)' in header:
        for cells in rows:
            if len(cells) < 9:
                continue
            name_sv, name_en, cat, era, lam, dens, thick, source, cert = [strip_md(c) for c in cells[:9]]
            lam_val = first_number(lam)
            if lam_val is None or lam.startswith('se kommentar') or lam.startswith('–'):
                lam_val = None
            mid = slug(name_sv)
            base = mid
            n = 2
            while mid in seen:
                mid = f'{base}-{n}'
                n += 1
            seen.add(mid)
            materials.append({
                'id': mid,
                'name': name_sv,
                'nameEn': name_en,
                'category': cat,
                'era': era,
                'lambda': lam_val,
                'lambdaText': lam,
                'densityText': dens if dens != '–' else None,
                'typicalThicknessText': thick,
                'source': source,
                'certainty': certainty(cert),
                'certaintyText': cert,
                'verified': False,
                'origin': 'data/materialbibliotek-TEMP.md (temporary test library)',
            })
    elif h0 == 'Värmeflödesriktning':
        for cells in rows:
            direction, example, rsi, rse, source, cert = [strip_md(c) for c in cells[:6]]
            key = {'Uppåt': 'up', 'Horisontellt (±30° från horisontalplanet)': 'horizontal', 'Nedåt': 'down'}.get(direction, slug(direction))
            surface[key] = {'rsi': first_number(rsi), 'rse': first_number(rse), 'example': example, 'source': source, 'certainty': certainty(cert), 'verified': False}
    elif h0 == 'Spalttjocklek mm':
        for cells in rows:
            t, up, hor, down = [strip_md(c) for c in cells[:4]]
            air_gaps.append({'thicknessMm': first_number(t), 'up': first_number(up), 'horizontal': first_number(hor), 'down': first_number(down)})
    elif h0 == 'Taktyp':
        for cells in rows:
            typ, ru, source, cert = [strip_md(c) for c in cells[:4]]
            attic.append({'roofType': typ, 'ru': first_number(ru), 'source': source, 'certainty': certainty(cert), 'verified': False})
    elif h0 == 'Namn (sv)' and any('U W/(m²K)' in h for h in header):
        for cells in rows:
            name, u, span, source, cert = [strip_md(c) for c in cells[:5]]
            kind = 'door' if re.search(r'dörr', name, re.I) else 'window'
            opening_defaults.append({'id': slug(name), 'name': name, 'kind': kind, 'U': first_number(u), 'uText': u, 'rangeText': span, 'source': source, 'certainty': certainty(cert), 'certaintyText': cert, 'verified': False})
    elif h0 == 'Konstruktion':
        for cells in rows:
            name, build, u, source, cert = [strip_md(c) for c in cells[:5]]
            construction_examples.append({'id': slug(name), 'name': name, 'buildUp': build, 'U': first_number(u), 'uText': u, 'source': source, 'certainty': certainty(cert), 'certaintyText': cert, 'verified': False})

# Constants used together with the library (sources in app/engine/constants.js).
out = {
    'version': 1,
    'generatedFrom': 'data/materialbibliotek-TEMP.md',
    'status': 'TEMPORARY test library. Compiled from search excerpts only; the source documents could not be opened. For testing only. Must be redone from the actual sources and reviewed by the user before real use (SPEC 3.8).',
    'certaintyLegend': {'S': 'value found in a search excerpt tied to the stated URL', 'S?': 'value found in a search excerpt, source page uncertain', 'E': 'estimate / from memory of EN ISO 10456:2007, not verified'},
    'materials': materials,
    'surfaceResistances': surface,
    'unventilatedAirGaps': {'unit': 'm²K/W', 'source': 'ISO 6946:2007 table 2 as reproduced in search excerpts (see data/materialbibliotek-TEMP.md §2b)', 'rows': air_gaps, 'verified': False},
    'atticRu': attic,
    'openingDefaults': opening_defaults,
    'constructionExamples': construction_examples,
}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(materials)} materials, {len(opening_defaults)} opening defaults, {len(construction_examples)} construction examples, surface {list(surface)} → {OUT}')
missing = [m['name'] for m in materials if m['lambda'] is None]
print('materials without a numeric lambda:', missing)
