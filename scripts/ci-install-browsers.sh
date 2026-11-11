#!/usr/bin/env bash
# Installs Playwright browsers and their system packages in CI.
# Retries, because the runners sometimes cannot reach the Ubuntu package servers for a while.
set -u
browser="$1"
for attempt in 1 2 3; do
  if pnpm exec playwright install --with-deps "$browser"; then
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "Browser install failed (attempt $attempt of 3). Retrying in $((attempt * 45)) s."
    sleep $((attempt * 45))
    sudo apt-get update || true
  fi
done
echo "Browser install failed after 3 attempts."
exit 1
