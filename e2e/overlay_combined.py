#!/usr/bin/env python3
"""Draw a combined-pass response over the base sheet's overview image. usage: overlay_combined.py <combined rid>"""
import json, os, sys, re, glob
from PIL import Image, ImageDraw
EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exchange')
rid = sys.argv[1]
req = json.load(open(os.path.join(EX, 'requests', rid, 'request.json')))
sheet = req['meta']['sheetId']
# find the overview request of this sheet
ov = None
for p in glob.glob(os.path.join(EX, 'requests', '*', 'request.json')):
    r = json.load(open(p))
    if r['jobType'] == 'overview' and r['meta'].get('sheetId') == sheet:
        ov = r; ovdir = os.path.dirname(p)
if not ov: sys.exit('no overview')
f = float(ov['meta']['scale'])
img = Image.open(os.path.join(ovdir, 'overview.png')).convert('RGB')
d = ImageDraw.Draw(img)
resp = json.load(open(os.path.join(EX, 'responses', rid + '.json')))['response']
for w in resp['walls']:
    col = (220, 0, 0) if w['exterior_guess'] else ((0, 0, 220) if w['exterior_guess'] is False else (200, 120, 0))
    d.line([(w['a']['x'] * f, w['a']['y'] * f), (w['b']['x'] * f, w['b']['y'] * f)], fill=col, width=max(1, int(w['thickness_px'] * f)))
for o in resp['openings']:
    col = (0, 170, 0) if o['kind'] == 'window' else (170, 0, 170)
    d.line([(o['a']['x'] * f, o['a']['y'] * f), (o['b']['x'] * f, o['b']['y'] * f)], fill=col, width=5)
for r in resp['rooms']:
    x, y = r['anchor']['x'] * f, r['anchor']['y'] * f
    d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 140, 0))
    d.text((x + 5, y - 5), r['id'] + ' ' + r['name'][:14], fill=(120, 60, 0))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overlays', rid + '_combined.png')
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out); print(out, img.size, 'scale', f)
