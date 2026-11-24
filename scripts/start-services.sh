#!/bin/bash
# 7Nights mini-services auto-start — runs before `next dev` so the lobby
# chat (:3003) and the multiplayer relay (:3030) are ALWAYS alive after a
# sandbox restart. Idempotent: a service already listening is left alone.
#
# This is the root-cause fix for the lobby chat being stuck on
# "Lighting the relay…" — the socket.io backends were simply down.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

start_if_down() {
  local port="$1" dir="$2" name="$3" log="$4"
  # any HTTP answer (even 404/Transport-unknown) means the port is alive
  if curl -s -m 2 -o /dev/null "http://localhost:${port}/"; then
    echo "[services] ${name} already up on :${port}"
  else
    echo "[services] starting ${name} on :${port}"
    (cd "${ROOT}/${dir}" && nohup bun run dev > "${ROOT}/${log}" 2>&1 &)
    # give it a moment, then confirm
    sleep 1.5
    if curl -s -m 2 -o /dev/null "http://localhost:${port}/"; then
      echo "[services] ${name} is up on :${port}"
    else
      echo "[services] WARNING: ${name} did not answer on :${port} (check ${log})"
    fi
  fi
}

start_if_down 3003 "mini-services/chat-service" "chat-service" "chat-service.log"
start_if_down 3030 "mini-services/relay"       "relay"        "relay-service.log"

exit 0
