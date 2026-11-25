#!/bin/bash
# run-pvp-e2e.sh — one-call end-to-end PvP duel: scripted Bob joins the LIVE
# room, the browser engine (Alice) teleports next to him and swings; Bob's
# script logs the incoming dmg events, floors Alice back at hit #3 (mercy) and
# ends her run with the second lethal — everything inside a single shell so
# the sandbox cannot reap the peer mid-experiment.
set -u
CODE="$1"
LOG=/tmp/pvp-peer.log
: > "$LOG"

echo "=== [1] Bob joins $CODE (100 s window) ==="
bun /home/z/my-project/scripts/pvp-peer-test.ts "$CODE" 100000 >> "$LOG" 2>&1 &
BOB=$!
sleep 4
tail -2 "$LOG"

echo "=== [2] waiting out the restart-together relaunch (36 s) ==="
sleep 36

echo "=== [3] teleport Alice next to Bob ==="
agent-browser --session game-pvp eval "(() => { const en=window.__vc.engine; en.player.x=38.7; en.player.z=12; en.player.vx=0; en.player.vz=0; return 'Alice @('+en.player.x+','+en.player.z+') invuln:'+en.invulnT.toFixed(1)+' remotes:'+JSON.stringify(en.remotes.map(function(r){return r.slot+'@('+r.x.toFixed(1)+','+r.z.toFixed(1)+')';})); })()" 2>&1 | tail -1

echo "=== [4] invuln drain (9 s) then a 16-swing combo ==="
sleep 9
agent-browser --session game-pvp eval "(() => { const en=window.__vc.engine; window.__combo={n:0}; const iv=setInterval(function(){ if (window.__combo.n>=16) { clearInterval(iv); return; } en.attack(); window.__combo.n++; },530); return 'combo started, invuln:'+en.invulnT.toFixed(1); })()" 2>&1 | tail -1
sleep 14

echo "=== [5] Alice's verdict ==="
agent-browser --session game-pvp eval "(() => { const en=window.__vc.engine; return 'alice swings:'+window.__combo.n+' hp:'+en.hp.toFixed(1)+' downT:'+en.downT.toFixed(2)+' pvpDowns:'+en.pvpDowns+' lost:'+en.lost+' remotes:'+JSON.stringify(en.remotes.map(function(r){return r.slot+' hp:'+r.hp.toFixed(0);})) ; })()" 2>&1 | tail -1

echo "=== [6] Bob's wire log ==="
rg "HIT|FLOORED|GETTING|hp .*->|RESULT|dmg events|VERIFIED|FAILED" "$LOG" | head -20

echo "=== [7] extra 6 s — let Bob's lethal land if pending ==="
sleep 6
rg "HIT|FLOORED|GETTING|RESULT|dmg events|VERIFIED|FAILED" "$LOG" | head -20
agent-browser --session game-pvp eval "(() => { const en=window.__vc.engine; return 'alice hp:'+en.hp.toFixed(1)+' lost:'+en.lost; })()" 2>&1 | tail -1
kill "$BOB" 2>/dev/null
echo "=== done ==="
