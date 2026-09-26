#!/usr/bin/env python3
"""Assist the manual-mode responder: find candidate wall segments (thick black bands) in a 1-bit scan tile.
usage: tileassist.py tile.png [min_len_px] [min_thick] -> prints segments and writes tile_walls.png overlay"""
import sys, numpy as np
from PIL import Image, ImageDraw

def runs(mask_1d):
    """yield (start, end) of True runs"""
    m = np.concatenate(([0], mask_1d.astype(np.int8), [0]))
    d = np.diff(m)
    starts = np.where(d == 1)[0]
    ends = np.where(d == -1)[0]
    return list(zip(starts, ends))

def find_bands(dark, axis, min_len, min_thick, max_thick):
    """Find bands: along `axis` we scan lines; a band is a set of consecutive lines whose dark runs overlap.
    axis=0: horizontal walls (scan rows), axis=1: vertical walls (scan columns)."""
    img = dark if axis == 0 else dark.T
    H, W = img.shape
    # for each row, long dark runs
    row_runs = {}
    for y in range(H):
        rr = [(s, e) for s, e in runs(img[y]) if e - s >= min_len]
        if rr:
            row_runs[y] = rr
    # group consecutive rows with overlapping runs into bands
    bands = []
    active = []  # each: {'y0', 'y1', 's', 'e'}
    for y in range(H):
        rr = row_runs.get(y, [])
        new_active = []
        used = [False] * len(rr)
        for a in active:
            matched = False
            for i, (s, e) in enumerate(rr):
                if used[i]:
                    continue
                ov = min(a['e'], e) - max(a['s'], s)
                if ov > 0.6 * min(a['e'] - a['s'], e - s):
                    a['y1'] = y
                    a['s'] = min(a['s'], s)
                    a['e'] = max(a['e'], e)
                    a['rows'].append((s, e))
                    used[i] = True
                    matched = True
                    new_active.append(a)
                    break
            if not matched:
                bands.append(a)
        for i, (s, e) in enumerate(rr):
            if not used[i]:
                new_active.append({'y0': y, 'y1': y, 's': s, 'e': e, 'rows': [(s, e)]})
        active = new_active
    bands.extend(active)
    out = []
    for b in bands:
        thick = b['y1'] - b['y0'] + 1
        if thick < min_thick or thick > max_thick:
            continue
        # use the median extent of rows as the segment extent (robust to text touching the wall)
        ss = sorted(r[0] for r in b['rows']); ee = sorted(r[1] for r in b['rows'])
        s = ss[len(ss) // 2]; e = ee[len(ee) // 2]
        if e - s < min_len:
            continue
        c = (b['y0'] + b['y1']) / 2
        if axis == 0:
            out.append({'a': (int(s), float(c)), 'b': (int(e), float(c)), 'thick': thick, 'orient': 'h'})
        else:
            out.append({'a': (float(c), int(s)), 'b': (float(c), int(e)), 'thick': thick, 'orient': 'v'})
    return out

def main():
    path = sys.argv[1]
    min_len = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    min_thick = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    max_thick = int(sys.argv[4]) if len(sys.argv) > 4 else 120
    im = Image.open(path).convert('L')
    a = np.array(im)
    dark = a < 128
    print(f'{path}: {im.width}x{im.height}, dark fraction {dark.mean():.4f}')
    segs = find_bands(dark, 0, min_len, min_thick, max_thick) + find_bands(dark, 1, min_len, min_thick, max_thick)
    segs.sort(key=lambda s: -(abs(s['b'][0] - s['a'][0]) + abs(s['b'][1] - s['a'][1])))
    ov = im.convert('RGB')
    d = ImageDraw.Draw(ov)
    for i, s in enumerate(segs[:400]):
        col = (255, 0, 0) if s['orient'] == 'h' else (0, 0, 255)
        d.line([s['a'], s['b']], fill=col, width=3)
        d.text(((s['a'][0] + s['b'][0]) / 2, (s['a'][1] + s['b'][1]) / 2), str(i), fill=(0, 160, 0))
        L = abs(s['b'][0] - s['a'][0]) + abs(s['b'][1] - s['a'][1])
        print(f"{i:3d} {s['orient']} a=({s['a'][0]:.0f},{s['a'][1]:.0f}) b=({s['b'][0]:.0f},{s['b'][1]:.0f}) len={L:.0f} thick={s['thick']}")
    out = path.replace('.png', '_walls.png')
    ov.save(out)
    print('overlay', out)

main()
