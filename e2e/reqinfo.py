#!/usr/bin/env python3
"""List request bundles: id, job type, meta, images; mark answered ones. usage: reqinfo.py [id]"""
import os
STALE=set(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'stale.txt')).read().split()) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),'stale.txt')) else set()
import json, os, sys, glob
EX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exchange')
ids = [sys.argv[1]] if len(sys.argv) > 1 else sorted(os.listdir(os.path.join(EX, 'requests')))
for rid in ids:
    d = os.path.join(EX, 'requests', rid)
    try:
        r = json.load(open(os.path.join(d, 'request.json')))
    except Exception as e:
        print(rid, 'unreadable', e); continue
    answered = os.path.exists(os.path.join(EX, 'responses', rid + '.json'))
    meta = r.get('meta') or {}
    print(f"{'✓' if answered else '·'} {rid} {r['jobType']:9s} model={r['model']} sheet={meta.get('sheetId')} tile={meta.get('tile') and (meta['tile']['col'], meta['tile']['row'], meta['tile']['x'], meta['tile']['y'], meta['tile']['w'], meta['tile']['h'])} level={meta.get('level')} imgs={r['images']}")
    if len(sys.argv) > 1:
        print('--- user prompt ---')
        print(r['user'][:6000])
