#!/usr/bin/env bash
# Smoke-test the tracker against every known regression event.
# Requires the dev server running: npm run dev  (http://localhost:3000)
# Each line: distinct pool names, totalTeams, finalStandings count.
# Re-pool events MUST show >1 distinct pool; none should repeat a pool name.
set -u
BASE="${BASE:-http://localhost:3000}"

# label | event token | division | team code
EVENTS=(
  "LSR 14 Bid          |PTAwMDAwNDEyNDA90|195174|g14askyl2ls"
  "SLC 14L (re-pool)   |PTAwMDAwNDIwNDA90|207190|g14askyl2ls"
  "SLC 14 Open         |PTAwMDAwNDIwNDA90|207193|g14askyl1ls"
  "ALSC2 (direct-brkt) |PTAwMDAwMzY5Njk90|171484|g14askyl2ls"
  "ALSC2 14s           |PTAwMDAwMzY5Njk90|171486|g14askyl1ls"
  "FAST Pre Nat'ls 14U |PTAwMDAwNDI0NjU90|203128|g14askyl1ls"
  "AAU 12 Classic CTX  |PTAwMDAwNDUwMjY90|213733|g12ctxjr1ls"
  "USAV 14 USA (Royal) |PTAwMDAwNDIwNjI90|200800|g14askyl1ls"
  "USAV 14 Amer (Roots)|PTAwMDAwNDIwNjI90|200821|g14roots1ls"
)

for row in "${EVENTS[@]}"; do
  IFS='|' read -r label ev div tc <<< "$row"
  curl -s "$BASE/api/tournament?team=${tc// /}&event=${ev// /}&division=${div// /}" \
  | LABEL="$label" python3 -c "
import json,sys,os
label=os.environ['LABEL'].strip()
try: d=json.load(sys.stdin)
except Exception: print(f'{label:22} ERROR (no JSON)'); sys.exit()
if 'error' in d: print(f'{label:22} ERROR {d[\"error\"]}'); sys.exit()
names=[p['poolName'] for p in d.get('pools',[])]
dup='  !!DUP POOL!!' if len(names)!=len(set(names)) else ''
repool=sum(1 for f in d.get('futurePaths',[]) if f.get('nextType')=='pool')
rp=f' repoolPred={repool}' if repool else ''
# Projected-path health: top-level branches and distinct division leaves reached
proj=d.get('projection'); divs=set()
if proj:
    stack=[proj]
    while stack:
        n=stack.pop()
        if n.get('kind')=='division': divs.add(n.get('name','').strip())
        stack+=[b['node'] for b in n.get('branches',[])]
pj=f' proj={len(proj[\"branches\"])}br/{len(divs)}div' if proj else ''
print(f'{label:22} pools={len(names)} {names} totalTeams={d.get(\"totalTeams\")} final={len(d.get(\"finalStandings\",[]))}{rp}{pj}{dup}')
"
done
