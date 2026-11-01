#!/usr/bin/env bash
# VoteChor — commit & push helper.
#
# Usage:
#   GITHUB_TOKEN=ghp_xxx scripts/git-push.sh "commit message"
#   scripts/git-push.sh "commit message"        # uses stored token / existing creds
#
# One-time token setup (stores the token so later pushes need no env var):
#   GITHUB_TOKEN=ghp_xxx scripts/git-push.sh --save-token

set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN_FILE=".github-token"
REMOTE="origin"

# --save-token: persist token for future runs
if [[ "${1:-}" == "--save-token" ]]; then
  [[ -n "${GITHUB_TOKEN:-}" ]] || { echo "✗ set GITHUB_TOKEN=... first"; exit 1; }
  printf '%s' "$GITHUB_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "✓ token saved to $TOKEN_FILE"
  exit 0
fi

# resolve token: env > token file
TOKEN="${GITHUB_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$TOKEN_FILE" ]]; then
  TOKEN="$(cat "$TOKEN_FILE")"
fi

MSG="${1:-chore: update}"
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  git add -A
  git commit -m "$MSG" || true
fi

if [[ -n "$TOKEN" ]]; then
  # push via token-bearing URL without persisting it in .git/config
  git push "https://x-access-token:${TOKEN}@github.com/zoiboxin/votchorforkids.git" HEAD:main
else
  git push "$REMOTE" HEAD:main
fi
echo "✓ pushed: $(git log -1 --oneline)"
