#!/usr/bin/env python3
"""Draw a response overlay onto the request image for self-checking. usage: overlay.py <id>"""
import json, os, sys
from PIL import Image, ImageDraw
EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exchange')
rid = sys.argv[1]
spec = json.load(open(os.path.join(EX, 'responses', rid + '.overlay.json')))
im = Image.open(spec['image']).convert('RGB')
d = ImageDraw.Draw(im)
P = lambda p: (p['x'], p['y'])
for w in spec['walls']:
    d.line([P(w['a']), P(w['b'])], fill=(255, 0, 0), width=max(2, int(w.get('thickness_px', 6) * 0.6)))
    m = ((w['a']['x'] + w['b']['x']) / 2, (w['a']['y'] + w['b']['y']) / 2)
    d.text(m, w['id'], fill=(200, 0, 0))
for o in spec['openings']:
    if 'a' in o:
        d.line([P(o['a']), P(o['b'])], fill=(0, 0, 255) if o['kind'] == 'window' else (160, 80, 0), width=6)
        d.text(P(o['a']), o['id'], fill=(0, 0, 255))
for o in spec['vopenings']:
    d.rectangle([o['x'], o['y'], o['x'] + o['w_px'], o['y'] + o['h_px']], outline=(0, 0, 255), width=3)
for g in spec['gaps']:
    d.line([P(g['a']), P(g['b'])], fill=(255, 140, 0), width=4)
    d.text(P(g['a']), f"gap {g['id']} {g['classification'][:3]}", fill=(255, 140, 0))
for r in spec['rooms']:
    c = r.get('center') or r.get('anchor')
    if c:
        d.ellipse([c['x'] - 8, c['y'] - 8, c['x'] + 8, c['y'] + 8], fill=(0, 160, 0))
        d.text((c['x'] + 10, c['y']), f"{r.get('label_text') or r.get('name','')} [{r.get('room_type','')}]", fill=(0, 120, 0))
for m in spec['refs']:
    d.line([P(m['a']), P(m['b'])], fill=(255, 0, 255), width=3)
    d.text(P(m['a']), f"{m['kind']} {m['value_text']}", fill=(255, 0, 255))
if spec['region']:
    r = spec['region']
    d.rectangle([r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']], outline=(0, 200, 0), width=3)
if spec['outline']:
    d.polygon([P(p) for p in spec['outline']], outline=(0, 0, 200))
for l in spec['levels']:
    d.line([(0, l['floor_line_y']), (im.width, l['floor_line_y'])], fill=(0, 160, 160), width=2)
    d.text((10, l['floor_line_y'] - 14), f"{l['name']} {l.get('level_text') or ''}", fill=(0, 120, 120))
out = os.path.join(EX, 'responses', rid + '.overlay.png')
im.save(out)
print(out)
