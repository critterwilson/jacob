#!/usr/bin/env bash
#
# M16 — enable Firestore per-doc TTL on idempotency-marker collections.
#
# Cloud Function v2 Firestore triggers are at-least-once, so every trigger
# writes a marker doc keyed on event.id under its parent (e.g.
# `groups/{gid}/messages/{mid}/_events/{eventId}`). Without TTL these
# accumulate forever — see docs/follow-ups/phase-2-deferred.md (M16).
#
# `expiresAt` is written by `functions/src/services/eventMarkers.ts` as
# `now + 7 days`. Firestore TTL on `expiresAt` reaps each doc on the next
# daily sweep after expiry (Google docs: "TTL deletions occur within 24h").
#
# Cost: free. Storage cost decreases as old markers are reclaimed.
#
# Usage:
#   ./infra/firestore-ttls.sh <project-id>
#
# Example (staging):
#   ./infra/firestore-ttls.sh jacob-staging-494515
#
# This script is idempotent — re-running it on already-enabled collections
# is a no-op (gcloud reports "no changes to apply").

set -euo pipefail

PROJECT_ID="${1:?project-id required, e.g. jacob-staging-494515}"

# All idempotency-marker collection groups across the function codebase.
# Discoverable via:  rg "collection\\(\"_[a-z_]*events\"\\)" functions/src
COLLECTION_GROUPS=(
  _events                  # onMessageWrite
  _reaction_events         # onReactionWrite + onBoardReactionWrite
  _index_events            # onMessageIndex
  _post_events             # onBoardPostWrite
  _reply_events            # onBoardReplyWrite
  _member_events           # onMemberWrite
  moderation_text_events   # text-moderation quota dedupe (PR11 / M3)
)

for cg in "${COLLECTION_GROUPS[@]}"; do
  echo "→ enabling TTL on expiresAt for collection-group=${cg}"
  gcloud firestore fields ttls update expiresAt \
    --collection-group="${cg}" \
    --enable-ttl \
    --project="${PROJECT_ID}"
done

echo
echo "Done. TTL takes effect on the next daily sweep (within 24h of doc expiry)."
echo "Verify with: gcloud firestore fields list --project=${PROJECT_ID} --filter='ttlConfig:*'"
