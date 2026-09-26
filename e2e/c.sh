#!/bin/bash
# usage: c.sh <cmd> [args...]  → sends to the driver server
cmd=$1; shift
python3 - "$cmd" "$@" <<'PY'
import json, sys, urllib.request
cmd = sys.argv[1]; args = sys.argv[2:]
req = urllib.request.Request('http://127.0.0.1:8124/', data=json.dumps({'cmd': cmd, 'args': args}).encode(), headers={'content-type': 'application/json'})
print(urllib.request.urlopen(req, timeout=1500).read().decode())
PY
