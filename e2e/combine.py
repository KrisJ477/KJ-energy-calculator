#!/usr/bin/env python3
"""Deterministic 'manual' answer for a combined-pass request: merges the tile data of the base sheet.
usage: combine.py <request-id> [plan_px_per_m=155.8] [vertical_px_per_m=165]
"""
import json, os, sys, math, statistics, re
EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exchange')
rid = sys.argv[1]
PPM = float(sys.argv[2]) if len(sys.argv) > 2 else 155.8
VPPM = float(sys.argv[3]) if len(sys.argv) > 3 else 165.0
req = json.load(open(os.path.join(EX, 'requests', rid, 'request.json')))
assert req['jobType'] == 'combined'
s = req['user']; i = s.find('{'); data = json.loads(s[i:s.rfind('}') + 1])
level = data['floor']['level']
base = next(sh for sh in data['sheets'] if sh['is_base'])
FLOOR_NAMES = {0: ['KÄLLARE', 'källare'], 1: ['BV'], 2: ['1 TR'], 3: ['2 TR'], 4: ['vind', '+35,35 vindsbjälklag']}

# ---------- collect ----------
walls, rooms, openings, gaps, notes = [], [], [], [], []
for ti, t in enumerate(base['tiles']):
    pre = f"t{t['tile']['col']}_{t['tile']['row']}."
    for w in t['walls']:
        walls.append({'ids': [pre + w['id']], 'a': dict(w['a']), 'b': dict(w['b']), 'th': float(w['thickness_px']), 'conf': float(w['confidence']), 'reason': w['reasoning']})
    for r in t['rooms']:
        rooms.append(dict(r, src=pre + r['id']))
    for o in t['openings']:
        openings.append(dict(o, src=pre + o['id'], wall_src=(pre + o['wall_ref']) if o.get('wall_ref') else ''))
    for g in t['gaps']:
        gaps.append(dict(g, src=pre + g['id'], wall_src=(pre + g['wall_ref']) if g.get('wall_ref') else ''))
    for n in t.get('notes', []):
        if n not in notes: notes.append(n)

# ---------- wall merge ----------
def seg(w):
    ax, ay, bx, by = w['a']['x'], w['a']['y'], w['b']['x'], w['b']['y']
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1.0
    return ax, ay, dx / L, dy / L, L

def angle_diff(w1, w2):
    _, _, ux, uy, _ = seg(w1); _, _, vx, vy, _ = seg(w2)
    d = abs(ux * vx + uy * vy)
    return math.degrees(math.acos(max(-1.0, min(1.0, d))))

def proj(w, p):
    ax, ay, ux, uy, _ = seg(w)
    return (p['x'] - ax) * ux + (p['y'] - ay) * uy

def perp(w, p):
    ax, ay, ux, uy, _ = seg(w)
    return abs((p['x'] - ax) * -uy + (p['y'] - ay) * ux)

def try_merge(w1, w2):
    if angle_diff(w1, w2) > 6: return None
    tol = max(32.0, max(w1['th'], w2['th']) * 0.6 + 8)
    if perp(w1, w2['a']) > tol or perp(w1, w2['b']) > tol: return None
    if abs(w1['th'] - w2['th']) > 12 and max(w1['th'], w2['th']) / max(1.0, min(w1['th'], w2['th'])) > 1.6: return None
    t1 = sorted([0.0, seg(w1)[4]]); t2 = sorted([proj(w1, w2['a']), proj(w1, w2['b'])])
    overlap = min(t1[1], t2[1]) - max(t1[0], t2[0])
    if overlap < -60: return None
    ax, ay, ux, uy, _ = seg(w1)
    lo, hi = min(t1[0], t2[0]), max(t1[1], t2[1])
    L1, L2 = seg(w1)[4], seg(w2)[4]
    th = (w1['th'] * L1 + w2['th'] * L2) / (L1 + L2)
    return {'ids': w1['ids'] + w2['ids'], 'a': {'x': round(ax + ux * lo), 'y': round(ay + uy * lo)}, 'b': {'x': round(ax + ux * hi), 'y': round(ay + uy * hi)}, 'th': round(th), 'conf': max(w1['conf'], w2['conf']), 'reason': (w1['reason'] if L1 >= L2 else w2['reason']) + ' [sammanfogad över rutgräns/överlapp]' if '[sammanfogad' not in (w1['reason'] if L1 >= L2 else w2['reason']) else (w1['reason'] if L1 >= L2 else w2['reason'])}

def merge_all(walls):
    changed = True
    while changed:
        changed = False
        out = []
        used = [False] * len(walls)
        for i1 in range(len(walls)):
            if used[i1]: continue
            cur = walls[i1]
            for i2 in range(i1 + 1, len(walls)):
                if used[i2]: continue
                m = try_merge(cur, walls[i2])
                if m:
                    cur = m; used[i2] = True; changed = True
            out.append(cur)
        walls = out
    return walls
walls = merge_all(walls)
# ---------- endpoint snapping (join corners and T-junctions left open by the tile reads) ----------
def dist(p, q): return math.hypot(p['x'] - q['x'], p['y'] - q['y'])
SNAP_M = float(sys.argv[4]) if len(sys.argv) > 4 else 0.30
SNAP = SNAP_M * PPM  # px: joins within 0.30 m are read as one junction; larger gaps stay gaps (SPEC 4.2)
def snap_endpoints(walls):
    n_end, n_junc = 0, 0
    ends = [(i, e) for i in range(len(walls)) for e in ('a', 'b')]
    parent = list(range(len(ends)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for x in range(len(ends)):
        for y in range(x + 1, len(ends)):
            if ends[x][0] == ends[y][0]: continue
            if dist(walls[ends[x][0]][ends[x][1]], walls[ends[y][0]][ends[y][1]]) <= SNAP:
                parent[find(x)] = find(y)
    groups = {}
    for k, (i, e) in enumerate(ends):
        groups.setdefault(find(k), []).append((i, e))
    for members in groups.values():
        if len(members) < 2: continue
        cx = sum(walls[i][e]['x'] for i, e in members) / len(members)
        cy = sum(walls[i][e]['y'] for i, e in members) / len(members)
        for i, e in members:
            walls[i][e] = {'x': round(cx), 'y': round(cy)}
        n_end += len(members)
    for i, w in enumerate(walls):
        for e in ('a', 'b'):
            best = None
            for j, o in enumerate(walls):
                if j == i: continue
                L = seg(o)[4]; t = proj(o, w[e]); d = perp(o, w[e])
                if d <= SNAP and -SNAP * 0.5 <= t <= L + SNAP * 0.5 and d > 0.5 and (best is None or d < best[0]):
                    best = (d, o, min(max(t, 0.0), L))
            if best:
                d, o, t = best
                ax, ay, ux, uy, _ = seg(o)
                w[e] = {'x': round(ax + ux * t), 'y': round(ay + uy * t)}
                n_junc += 1
    return n_end, n_junc
snapped = snap_endpoints(walls)
walls = merge_all(walls)
wall_id_of_src = {}
for k, w in enumerate(walls):
    w['id'] = f'w{k+1}'
    for sid in w['ids']: wall_id_of_src[sid] = w['id']

def ext_guess(w):
    r = w['reason'].lower()
    if 'ytterv' in r or 'fasad' in r or 'gavel' in r or 'brandv' in r: return True
    if 'innerv' in r or 'mellanv' in r or 'lägenhetsskilj' in r or 'skiljev' in r: return False
    return True if w['th'] >= 40 else None

def nearest_wall(p, maxd=70):
    best, bd = None, maxd
    for w in walls:
        t = proj(w, p); L = seg(w)[4]
        if t < -20 or t > L + 20: continue
        d = perp(w, p)
        if d < bd: best, bd = w, d
    return best

# ---------- rooms ----------
def dist(p, q): return math.hypot(p['x'] - q['x'], p['y'] - q['y'])
merged_rooms = []
for r in sorted(rooms, key=lambda r: -(r['room_type_confidence'] + (0.5 if r['label_text'] else 0))):
    dup = None
    for m in merged_rooms:
        d = dist(m['center'], r['center'])
        same_label = r['label_text'].strip().lower() == m['label_text'].strip().lower() and (r['apartment'] or '') == (m['apartment'] or '')
        if (same_label and r['label_text'] and d < 320) or (d < 140 and r['room_type'] == m['room_type']) or (d < 90):
            dup = m; break
    if dup:
        dup['srcs'].append(r['src'])
        if not dup['apartment'] and r['apartment']: dup['apartment'] = r['apartment']
        if not dup['label_text'] and r['label_text']: dup['label_text'] = r['label_text']
        continue
    merged_rooms.append(dict(r, srcs=[r['src']]))
SV = {'living': 'Rum', 'bedroom': 'Sovrum', 'kitchen': 'Kök', 'bathroom': 'Bad', 'wc': 'WC', 'hall': 'Hall', 'storage': 'Förråd', 'stairwell': 'Trapphus', 'laundry': 'Tvättstuga', 'office': 'Kontor', 'shop': 'Butik', 'garage': 'Garage', 'loggia': 'Loggia', 'corridor': 'Korridor', 'technical': 'Teknik', 'other': 'Övrigt', 'unknown': 'Okänt'}
counters = {}
out_rooms = []
for r in merged_rooms:
    apt = (r['apartment'] or '').strip()
    key = apt if apt else f'G{level}'
    counters[key] = counters.get(key, 0) + 1
    name = r['label_text'].strip() or SV.get(r['room_type'], 'Rum')
    out_rooms.append({'id': f'{key}:{counters[key]}', 'name': name, 'room_type': r['room_type'], 'room_type_confidence': r['room_type_confidence'], 'reasoning': r['reasoning'] + (f" (rumstext saknas, namn efter rumstyp)" if not r['label_text'].strip() else '') + f" [källa: {', '.join(r['srcs'])}]", 'anchor': {'x': r['center']['x'], 'y': r['center']['y']}, 'apartment': apt, 'printed_area_m2': r.get('printed_area_m2'), 'heated_guess': bool(r.get('heated_guess', True))})

# ---------- vertical openings for this floor ----------
names = FLOOR_NAMES.get(level, [])
vopen = [dict(v, sheet_id=vd['sheet_id']) for vd in data['vertical_drawings'] for v in vd['openings'] if v['floor_name'] in names]
def med(xs, default=None):
    return statistics.median(xs) if xs else default
vwin = [v for v in vopen if v['kind'] == 'window' and v['confidence'] >= 0.5]
vdoor = [v for v in vopen if v['kind'] == 'door']
win_h_mm = med([v['h_px'] / VPPM * 1000 for v in vwin])
door_h_mm = med([v['h_px'] / VPPM * 1000 for v in vdoor if v['confidence'] >= 0.5])
SILL = {0: (2000, 'källarfönster strax under sockelns överkant enligt fasaderna 296420/296421: ca 2,0 m över källargolvet +23,35'), 1: (800, 'bröstning 0,80 enligt sektion 296422'), 2: (800, 'bröstning 0,80 enligt sektion 296422'), 3: (800, 'bröstning 0,80 enligt sektion 296422'), 4: (None, 'takkupor/lunettfönster: bröstning framgår inte')}

# ---------- openings ----------
merged_open = []
for o in sorted(openings, key=lambda o: -o['confidence']):
    mid = {'x': (o['a']['x'] + o['b']['x']) / 2, 'y': (o['a']['y'] + o['b']['y']) / 2}
    if any(m['kind'] == o['kind'] and dist(m['_mid'], mid) < 60 for m in merged_open):
        continue
    merged_open.append(dict(o, _mid=mid))
out_open = []
for k, o in enumerate(merged_open):
    wid = wall_id_of_src.get(o['wall_src'])
    if not wid:
        nw = nearest_wall(o['_mid'])
        wid = nw['id'] if nw else ''
    wall = next((w for w in walls if w['id'] == wid), None)
    width_mm = o['width_px'] / PPM * 1000
    h, hc, src, link, sill = None, None, '', None, None
    reason = o['reasoning']
    exterior = ext_guess(wall) if wall else None
    if o['kind'] == 'window':
        cands = [v for v in vwin if abs(v['w_px'] / VPPM * 1000 - width_mm) <= 0.25 * width_mm]
        if cands:
            h = round(med([v['h_px'] / VPPM * 1000 for v in cands]) / 10) * 10; hc = 'MEDIUM'
            v = max(cands, key=lambda v: v['confidence'])
            src = f"fasad {v['sheet_id']}: fönster av samma bredd på våningen ({v['floor_name']}); höjd {v['h_px']} px vid {VPPM:.0f} px/m"
            link = {'sheet_id': v['sheet_id'], 'x': v['x'], 'y': v['y'], 'w': v['w_px'], 'h': v['h_px']}
        elif win_h_mm:
            h = round(win_h_mm / 10) * 10; hc = 'LOW'
            src = f'medianhöjd för fönster på våningen i fasaderna ({len(vwin)} st); ingen breddmatchning'
        else:
            src = 'ingen vertikal ritning för denna våning'
        sill, sill_why = SILL.get(level, (None, ''))
        if sill is not None: reason += f'; bröstning: {sill_why}'
    else:
        if exterior and vdoor:
            cands = [v for v in vdoor if abs(v['w_px'] / VPPM * 1000 - width_mm) <= 0.3 * width_mm]
            if cands:
                h = round(med([v['h_px'] / VPPM * 1000 for v in cands]) / 10) * 10; hc = 'MEDIUM'
                v = max(cands, key=lambda v: v['confidence'])
                src = f"fasad {v['sheet_id']}: dörr av samma bredd på våningen"
                link = {'sheet_id': v['sheet_id'], 'x': v['x'], 'y': v['y'], 'w': v['w_px'], 'h': v['h_px']}
            elif door_h_mm:
                h = round(door_h_mm / 10) * 10; hc = 'LOW'; src = 'medianhöjd för ytterdörrar i fasaderna'
            else:
                src = 'ingen dörr i fasaderna att matcha mot'
        else:
            src = 'innerdörr: höjd visas inte på planritningen och inte i fasaderna'
    out_open.append({'id': f'o{k+1}', 'kind': o['kind'], 'wall_ref': wid, 'a': o['a'], 'b': o['b'], 'width_px': o['width_px'], 'recess_width_px': o.get('recess_width_px'), 'height_estimate_mm': h, 'height_confidence': hc, 'height_source': src, 'vertical_link': link, 'sill_mm': sill, 'confidence': o['confidence'], 'reasoning': reason + f" [källa: {o['src']}]"})

out_gaps = []
for k, g in enumerate(gaps):
    wid = wall_id_of_src.get(g['wall_src'])
    if not wid:
        mid = {'x': (g['a']['x'] + g['b']['x']) / 2, 'y': (g['a']['y'] + g['b']['y']) / 2}
        nw = nearest_wall(mid); wid = nw['id'] if nw else ''
    out_gaps.append({'id': f'g{k+1}', 'wall_ref': wid, 'a': g['a'], 'b': g['b'], 'classification': g['classification'], 'reasoning': g['reasoning'] + f" [källa: {g['src']}]"})

out_walls = [{'id': w['id'], 'sheet_id': base['sheet_id'], 'a': w['a'], 'b': w['b'], 'thickness_px': w['th'], 'exterior_guess': ext_guess(w), 'confidence': w['conf'], 'reasoning': w['reason'], 'source_ids': w['ids']} for w in walls]
offsets = [{'sheet_id': sh['sheet_id'], 'dx': 0, 'dy': 0, 'reasoning': 'Skalreferensblad (1924) utan detaljrutor: förskjutningen bestäms i den manuella inpassningen (SPEC 4.4); 0/0 är en platshållare.'} for sh in data['sheets'] if not sh['is_base']]
if level == 0:
    ug = {'percent': 35, 'reasoning': 'Fasaderna anger mark +24,06…+24,85 och sektionen källargolv +23,35 / BV-golv +26,35: marken ligger i medeltal ca 1,05 m över källargolvet av 3,00 m våningshöjd ≈ 35 %.'}
else:
    ug = {'percent': 0, 'reasoning': 'Våningen ligger helt ovan mark enligt fasaderna (marklinje under BV-golvet +26,35).'}
fh = 3000 if level in (0, 1, 2, 3) else None
method = [f'Väggändar sammanförda: {snapped[0]} ändpunkter i hörn och {snapped[1]} T-anslutningar inom {SNAP_M:.2f} m ({SNAP:.0f} px); större glapp lämnas som luckor.', f'Sammanslagning: {len(base["tiles"])} rutor, {sum(len(t["walls"]) for t in base["tiles"])} väggsegment → {len(walls)} väggar (kollineära segment inom 6° och ≤ 22 px sidoavstånd sammanfogade, glapp ≤ 60 px), {len(rooms)} rumsmarkeringar → {len(out_rooms)} rum, {len(openings)} öppningar → {len(out_open)} unika.',
          f'Skalantagande för fönsterbreddsmatchning: plan ≈ {PPM} px/m (skalstock på BV-bladet), fasader ≈ {VPPM} px/m (våningshöjd 3,00 m ≈ 490 px).',
          'Våningshöjd 3,00 m enligt sektion 296422 (skrivna mått) för källare, BV, 1 TR och 2 TR; vinden har snedtak (3,85 m till nock) och ges ingen våningshöjd här.' if level != 4 else 'Vinden: takstol med 3,85 m till nock enligt sektionen; golv-till-golv saknas – höjden måste anges av användaren.']
resp = {'walls': out_walls, 'rooms': out_rooms, 'openings': out_open, 'gaps': out_gaps, 'sheet_offsets': offsets, 'underground_guess': ug, 'floor_height_mm': fh, 'notes': method + notes}
os.makedirs(os.path.join(EX, 'responses'), exist_ok=True)
outp = os.path.join(EX, 'responses', rid + '.json')
json.dump({'requestId': rid, 'response': resp}, open(outp, 'w'), ensure_ascii=False)
print(f'wrote {outp}: walls {len(out_walls)} rooms {len(out_rooms)} openings {len(out_open)} gaps {len(out_gaps)}')
