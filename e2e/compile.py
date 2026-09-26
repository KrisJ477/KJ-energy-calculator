#!/usr/bin/env python3
"""Compile a compact annotation file into a schema-valid response JSON for a request.
usage: compile.py <request-id> <annotation-file>
Lines (tile):
  AUTO min_len min_thick max_thick     use tileassist detector for walls (tile-relative px)
  SKIP n,n,...                         drop detector segments by index
  W id x1 y1 x2 y2 thick [conf] [reason...]
  R label|type x y [apt=..] [area=..] [heated=0|1] [conf=..] [reason...]   room; label '-' for none; type from enum
  O window|door wallref x1 y1 x2 y2 [recess=px] [arc=0|1] [conf=..] [reason...]
  G x1 y1 x2 y2 opening|artifact|uncertain [wallref=..] reason...
  T kind x y text...                   text label (room_name|apartment|dimension|level|fixture|other)
  N note...
Lines (vertical):
  L name level_number|- y [text=+26.35] reason...
  F lower upper height_px [text=..] reason...
  V window|door x y w h [sill=..] [floor=..] [label=..] [conf=..] reason...
  GND y|- reason...
  ROOF cold|warm|- reason...
  REF dimension|scale_bar|level_difference x1 y1 x2 y2 text [mm=..] reason...
  CLASS type=plan|vertical|other sub=section|elevation|- disc=architectural|.. part=.. stamp=.. bar=0|1 dims=0|1 clarity=.. compl=.. reason...
  FLOOR name level_number|- reason...
  REGION x y w h
  OUTLINE x,y x,y ...
  RR label x y                         rough room (overview)
  TITLE text...
Every wall/opening/gap/room gets an id; reasoning defaults are generated.
"""
import json, os, sys, subprocess, re
EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exchange')
rid, ann = sys.argv[1], sys.argv[2]
req = json.load(open(os.path.join(EX, 'requests', rid, 'request.json')))
job = req['jobType']
img = os.path.join(EX, 'requests', rid, req['images'][0]) if req['images'] else None
lines = [l.rstrip('\n') for l in open(ann, encoding='utf-8') if l.strip() and not l.startswith('#')]

def kv(tokens):
    """split tokens into positional and key=value; returns (pos, dict, rest_text)"""
    pos, d = [], {}
    for t in tokens:
        m = re.match(r'^(\w+)=(.*)$', t)
        if m and m.group(1) in ('apt', 'area', 'heated', 'conf', 'recess', 'arc', 'wallref', 'text', 'sill', 'floor', 'label', 'mm', 'type', 'sub', 'disc', 'part', 'stamp', 'bar', 'dims', 'clarity', 'compl', 'role', 'rolewhy'):
            d[m.group(1)] = m.group(2)
        else:
            pos.append(t)
    return pos, d

def num(s):
    return float(s.replace(',', '.'))

walls, rooms, openings, gaps, texts, notes = [], [], [], [], [], []
levels, ftf, vopen, refs = [], [], [], []
ground = {'y': None, 'reasoning': 'ingen marklinje i denna ruta'}
roof = {'cold_attic': None, 'reasoning': 'framgår inte av denna ruta'}
cls = None
floors = []
region = None
outline = []
rough = []
title = []
auto_segs = []
skip = set()
wid = 0
for line in lines:
    tok = line.split()
    cmd = tok[0]
    if cmd == 'AUTO':
        out = subprocess.run(['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tileassist.py'), img, *tok[1:4]], capture_output=True, text=True).stdout
        for l in out.splitlines():
            m = re.match(r'^\s*(\d+) ([hv]) a=\((-?\d+),(-?\d+)\) b=\((-?\d+),(-?\d+)\) len=(\d+) thick=(\d+)', l)
            if m:
                auto_segs.append({'i': int(m.group(1)), 'a': (int(m.group(3)), int(m.group(4))), 'b': (int(m.group(5)), int(m.group(6))), 'thick': int(m.group(8))})
    elif cmd == 'SKIP':
        skip |= set(int(x) for x in tok[1].split(',') if x)
    elif cmd == 'W':
        pos, d = kv(tok[1:])
        i, x1, y1, x2, y2, th = pos[:6]
        conf = num(pos[6]) if len(pos) > 6 and re.match(r'^[0-9.]+$', pos[6]) else 0.8
        reason = ' '.join(pos[7:]) if len(pos) > 7 else 'vägg avläst som svart band'
        walls.append({'id': i, 'a': {'x': num(x1), 'y': num(y1)}, 'b': {'x': num(x2), 'y': num(y2)}, 'thickness_px': num(th), 'confidence': conf, 'reasoning': reason})
    elif cmd == 'R':
        pos, d = kv(tok[1:])
        label, typ, x, y = pos[0], pos[1], num(pos[2]), num(pos[3])
        reason = ' '.join(pos[4:]) or f'rumstext "{label}" i rummet'
        rooms.append({'id': f'r{len(rooms)+1}', 'label_text': '' if label == '-' else label.replace('_', ' '), 'room_type': typ, 'room_type_confidence': num(d.get('conf', '0.8')), 'reasoning': reason, 'center': {'x': x, 'y': y}, 'apartment': d.get('apt', ''), 'printed_area_m2': num(d['area']) if 'area' in d else None, 'heated_guess': d.get('heated', '1') != '0'})
    elif cmd == 'O':
        pos, d = kv(tok[1:])
        kind, wref, x1, y1, x2, y2 = pos[:6]
        reason = ' '.join(pos[6:]) or ('fönstersymbol i yttervägg' if kind == 'window' else 'dörröppning')
        w = ((num(x2) - num(x1)) ** 2 + (num(y2) - num(y1)) ** 2) ** 0.5
        openings.append({'id': f'o{len(openings)+1}', 'kind': kind, 'wall_ref': '' if wref == '-' else wref, 'a': {'x': num(x1), 'y': num(y1)}, 'b': {'x': num(x2), 'y': num(y2)}, 'width_px': round(w, 1), 'recess_width_px': num(d['recess']) if 'recess' in d else None, 'has_swing_arc': d.get('arc', '0') == '1', 'confidence': num(d.get('conf', '0.7')), 'reasoning': reason})
    elif cmd == 'G':
        pos, d = kv(tok[1:])
        x1, y1, x2, y2, c = pos[:5]
        reason = ' '.join(pos[5:]) or 'lucka i vägglinjen'
        gaps.append({'id': f'g{len(gaps)+1}', 'wall_ref': d.get('wallref', ''), 'a': {'x': num(x1), 'y': num(y1)}, 'b': {'x': num(x2), 'y': num(y2)}, 'classification': c, 'reasoning': reason})
    elif cmd == 'T':
        kind, x, y = tok[1], num(tok[2]), num(tok[3])
        texts.append({'text': ' '.join(tok[4:]), 'at': {'x': x, 'y': y}, 'kind': kind})
    elif cmd == 'N':
        notes.append(' '.join(tok[1:]))
    elif cmd == 'L':
        pos, d = kv(tok[1:])
        name, ln, y = pos[0], pos[1], num(pos[2])
        levels.append({'name': name.replace('_', ' '), 'level_number': None if ln == '-' else int(ln), 'floor_line_y': y, 'level_text': d.get('text'), 'reasoning': ' '.join(pos[3:]) or 'golvlinje i sektionen/fasaden'})
    elif cmd == 'F':
        pos, d = kv(tok[1:])
        ftf.append({'lower': pos[0].replace('_', ' '), 'upper': pos[1].replace('_', ' '), 'height_px': num(pos[2]), 'height_text': d.get('text'), 'reasoning': ' '.join(pos[3:]) or 'avstånd mellan golvlinjer'})
    elif cmd == 'V':
        pos, d = kv(tok[1:])
        kind, x, y, w, hh = pos[0], num(pos[1]), num(pos[2]), num(pos[3]), num(pos[4])
        vopen.append({'id': f'v{len(vopen)+1}', 'kind': kind, 'x': x, 'y': y, 'w_px': w, 'h_px': hh, 'sill_px': num(d['sill']) if 'sill' in d else None, 'floor_name': d.get('floor', '').replace('_', ' '), 'label': d.get('label', ''), 'confidence': num(d.get('conf', '0.7')), 'reasoning': ' '.join(pos[5:]) or 'öppning i fasaden'})
    elif cmd == 'GND':
        ground = {'y': None if tok[1] == '-' else num(tok[1]), 'reasoning': ' '.join(tok[2:]) or 'marklinje'}
    elif cmd == 'ROOF':
        roof = {'cold_attic': {'cold': True, 'warm': False}.get(tok[1]), 'reasoning': ' '.join(tok[2:]) or ''}
    elif cmd == 'REF':
        pos, d = kv(tok[1:])
        kind, x1, y1, x2, y2, text = pos[0], num(pos[1]), num(pos[2]), num(pos[3]), num(pos[4]), pos[5]
        refs.append({'kind': kind, 'a': {'x': x1, 'y': y1}, 'b': {'x': x2, 'y': y2}, 'value_text': text.replace('_', ' '), 'value_mm': num(d['mm']) if 'mm' in d else None, 'reasoning': ' '.join(pos[6:]) or 'måttsatt sträcka'})
    elif cmd == 'CLASS':
        pos, d = kv(tok[1:])
        cls = {'type': d.get('type', 'plan'), 'vertical_subtype': None if d.get('sub', '-') == '-' else d['sub'], 'discipline': d.get('disc', 'architectural'), 'floors': [], 'part_of_floor': d.get('part', '').replace('_', ' '), 'scale_stamp': d.get('stamp') if d.get('stamp', '-') != '-' else None, 'has_scale_bar': d.get('bar', '0') == '1', 'has_written_dimensions': d.get('dims', '0') == '1', 'clarity': num(d.get('clarity', '0.7')), 'completeness': num(d.get('compl', '0.9')), 'proposed_role': d.get('role', 'base'), 'role_reasoning': d.get('rolewhy', 'roll enligt projektbriefen').replace('_', ' '), 'reasoning': ' '.join(pos)}
    elif cmd == 'FLOOR':
        floors.append({'name': tok[1].replace('_', ' '), 'level_number': None if tok[2] == '-' else int(tok[2]), 'reasoning': ' '.join(tok[3:]) or 'våningsnamn i ritningshuvudet'})
    elif cmd == 'REGION':
        region = {'x': num(tok[1]), 'y': num(tok[2]), 'w': num(tok[3]), 'h': num(tok[4])}
    elif cmd == 'OUTLINE':
        outline = [{'x': num(p.split(',')[0]), 'y': num(p.split(',')[1])} for p in tok[1:]]
    elif cmd == 'RR':
        rough.append({'label': tok[1].replace('_', ' '), 'center': {'x': num(tok[2]), 'y': num(tok[3])}})
    elif cmd == 'TITLE':
        title.append(' '.join(tok[1:]))
    else:
        print('unknown line', line, file=sys.stderr)

for s in auto_segs:
    if s['i'] in skip:
        continue
    wid += 1
    walls.append({'id': f'a{s["i"]}', 'a': {'x': s['a'][0], 'y': s['a'][1]}, 'b': {'x': s['b'][0], 'y': s['b'][1]}, 'thickness_px': s['thick'], 'confidence': 0.85, 'reasoning': f'heldragen svart väggmarkering, tjocklek {s["thick"]} px'})

if job == 'tile':
    data = {'walls': walls, 'rooms': rooms, 'openings': openings, 'gaps': gaps, 'text_labels': texts, 'notes': notes}
elif job == 'vertical':
    if cls is None:
        cls = {'type': 'vertical', 'vertical_subtype': 'elevation', 'discipline': 'architectural', 'floors': [], 'part_of_floor': '', 'scale_stamp': None, 'has_scale_bar': False, 'has_written_dimensions': False, 'clarity': 0.7, 'completeness': 0.8, 'proposed_role': 'base', 'role_reasoning': 'vertikal ritning som läses för höjder', 'reasoning': 'fasad/sektion'}
    cls['floors'] = floors
    data = {'classification': cls, 'drawing_region': region or {'x': 0, 'y': 0, 'w': 0, 'h': 0}, 'levels': levels, 'floor_to_floor': ftf, 'openings': vopen, 'ground_line': ground, 'roof': roof, 'reference_measurements': refs, 'notes': notes}
elif job == 'overview':
    cls['floors'] = floors
    data = {'classification': cls, 'drawing_region': region, 'building_outline': outline, 'rough_rooms': rough, 'reference_measurements': refs, 'title_text': title, 'notes': notes}
else:
    raise SystemExit('unsupported job for compile: ' + job)
out = os.path.join(EX, 'responses', rid + '.json')
json.dump({'requestId': rid, 'response': data}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('wrote', out, f"walls={len(walls)} rooms={len(rooms)} openings={len(openings)} gaps={len(gaps)} texts={len(texts)}")
