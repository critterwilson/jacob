#!/usr/bin/env bash
# Inner script wrapped by `firebase emulators:exec` in CI.
#
# Assumes the Auth emulator is already running on $FIREBASE_AUTH_EMULATOR_HOST,
# and that the frontend has already been built with the emulator NEXT_PUBLIC_*
# vars baked in. Steps: seed shared user, start frontend, wait for it,
# run Playwright. Frontend server is killed on exit.
set -euo pipefail

if [[ -z "${FIREBASE_AUTH_EMULATOR_HOST:-}" ]]; then
  echo "::error::FIREBASE_AUTH_EMULATOR_HOST is not set; emulator must be running."
  exit 1
fi

if [[ -n "${JACOB_E2E_USER_UID:-}" ]]; then
  node frontend/e2e/scripts/seed-emulator.mjs
else
  echo "::warning::JACOB_E2E_USER_UID not set — skipping emulator seed (shared-account tests will skip)."
fi

# Start the frontend in the background. PORT defaults to 3000 for next start.
PORT=3000 pnpm --filter jacob-frontend start > frontend-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait up to 60s for Next.js to come up. /sign-in is a known-good route
# (no middleware redirect, no auth required).
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3000/sign-in; then
    echo "frontend ready after ${i}s"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "::error::frontend process exited early"
    cat frontend-server.log
    exit 1
  fi
  sleep 1
done

if ! curl -sf -o /dev/null http://localhost:3000/sign-in; then
  echo "::error::frontend never became ready"
  cat frontend-server.log
  exit 1
fi

pnpm --filter jacob-frontend test:e2e
