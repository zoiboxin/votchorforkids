#!/bin/bash
# Detached Next dev start (same pattern as start-services.sh so the process
# survives the launching shell): waits for the port, then probes warm.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if curl -s -m 2 -o /dev/null "http://localhost:3000/"; then
  echo "[next] already up on :3000"
  exit 0
fi

echo "[next] starting (detached)…"
nohup bun run dev > /dev/null 2>&1 < /dev/null &

for i in $(seq 1 30); do
  sleep 1
  if curl -s -m 2 -o /dev/null "http://localhost:3000/"; then
    echo "[next] up after ${i}s"
    exit 0
  fi
done
echo "[next] WARNING: did not answer on :3000 within 30s (check dev.log)"
exit 1
