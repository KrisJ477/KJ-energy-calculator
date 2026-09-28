#!/bin/bash
# Re-run the combined pass for the given levels and answer each request with combine.py
cd "$(dirname "$0")/.."
levels="$1"   # e.g. "0,1,2,3,4"
timeout 60 ./e2e/c.sh eval "window.__readDone=false; window.__readError=null; (async()=>{ store.update((p)=>{ p.levels.forEach((l)=>{ l.referenceWalls=null; }); },{undoable:false}); for (const l of [$levels]) await ctx.runner.combinedPass(l); store.update((p)=>{p.ui.readDone=true},{undoable:false}); })().then(()=>(window.__readDone=true)).catch((e)=>(window.__readError=String(e.stack||e))); return 'started'"
for i in $(seq 1 30); do
  sleep 12
  timeout 60 ./e2e/c.sh pull >/dev/null
  for r in $(python3 e2e/reqinfo.py | grep "^·" | grep -v -f e2e/stale.txt | grep combined | awk '{print $2}'); do
    [ -f e2e/exchange/responses/$r.json ] && continue
    lvl=$(python3 -c "import json;print(json.load(open('e2e/exchange/requests/$r/request.json'))['meta']['level'])")
    snap=0.30; [ "$lvl" = "4" ] && snap=0.60
    echo "== $r level=$lvl snap=$snap"
    (cd e2e && python3 combine.py $r 155.8 165 $snap | cut -c1-80 && node checkresp.mjs $r)
    timeout 60 ./e2e/c.sh push
  done
  st=$(timeout 60 ./e2e/c.sh eval "return [window.__readDone, window.__readError]" | tr -d '\n ')
  echo "status $st"
  echo "$st" | grep -q "true\|rror" && break
done
echo RERUN_FINISHED
