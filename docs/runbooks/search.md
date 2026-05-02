# Runbook — Typesense search sidecar (T28)

This runbook covers the operational tasks for the JACOB full-text
message search sidecar. Architecture, vendor decision, and threat
model are in `docs/adr/0005-search-sidecar.md`.

## Quick reference

| Component | Where it lives |
|---|---|
| Backend search endpoint | `GET /api/search` (`backend/app/routers/search.py`) |
| Cloud Function indexer  | `onMessageIndex` (`functions/src/onMessageIndex.ts`) |
| Reindex script          | `infra/scripts/reindex_messages.py` |
| Terraform               | `infra/typesense.tf` |
| ADR                     | `docs/adr/0005-search-sidecar.md` |

## Kill switches

- **Backend feature flag (user-visible):** set `JACOB_SEARCH_ENABLED=false`
  on the Cloud Run service. The endpoint immediately returns
  `503 { code: "search_disabled" }`. Use this when search is
  misbehaving end-to-end and you want users to stop hitting it.
- **Cloud Function kill switch:** set `TYPESENSE_DISABLED=true` on the
  function. The trigger no-ops (logs `search_index_disabled`). Use
  this when Typesense itself is down or running away on cost; the
  index will fall behind but no Firestore writes are blocked.

Both flags are env vars, so changes take effect on the next cold
start. To force, redeploy the service (Cloud Run → "Edit and deploy
new revision").

## Outage — Typesense unreachable

1. **Confirm the symptom.** The backend log line
   `search_unavailable uid=... err=...` will appear; users see
   `503 { code: "search_unavailable" }`.
2. Check the Cloud Run service health for `typesense-${env}`. If the
   instance is unhealthy, restart it (Cloud Run → "Edit and deploy
   new revision" with no changes).
3. If the data volume is corrupt, restore from the most recent GCS
   bucket version (the Typesense data dir is on a versioned bucket
   per `infra/typesense.tf`). After restore, re-run the reindex
   script — see "Full reindex" below.
4. While search is offline, set `JACOB_SEARCH_ENABLED=false` so users
   get a clean disabled message instead of a 503 spinner.

## Full reindex

Run when:
- The Typesense collection has been dropped or restored from an old snapshot.
- A schema migration added a new field (see "Schema migration" below).
- Drift is suspected (counts differ from Firestore by more than 1%).

```sh
GCP_PROJECT_ID=jacob-${ENV} \
TYPESENSE_HOST=$(gcloud run services describe typesense-${ENV} \
  --region us-central1 --format 'value(status.url)') \
TYPESENSE_ADMIN_KEY=$(gcloud secrets versions access latest \
  --secret typesense-admin-key-${ENV}) \
TYPESENSE_COLLECTION=messages \
python infra/scripts/reindex_messages.py
```

The script is idempotent — re-running converges to the same state. It
prints `[reindex] gid=... batch_flushed=N total=M` per batch and
`[reindex] done upserted=N skipped_deleted=M` at the end.

Acceptance: counts within 1% of Firestore (the 1% slack covers
soft-deleted messages skipped by the script). Cross-check with:

```sh
# Firestore count
gcloud firestore documents count --collection-group messages \
  --filter "deletedAt = NULL"

# Typesense count
curl -s -H "X-TYPESENSE-API-KEY: $TYPESENSE_ADMIN_KEY" \
  "$TYPESENSE_HOST/collections/messages" | jq .num_documents
```

## API-key rotation

Two keys live in Secret Manager: the admin key (writes, used by the
function) and the search key (reads, used by the backend). Rotate
each independently to minimise downtime.

```sh
# Admin key
NEW_ADMIN=$(openssl rand -hex 32)
echo -n "$NEW_ADMIN" | gcloud secrets versions add \
  typesense-admin-key-${ENV} --data-file=-
# Restart the function to pick up the new value
firebase functions:config:set search.bumped_at="$(date)" \
  --project jacob-${ENV}
firebase deploy --only functions:onMessageIndex --project jacob-${ENV}

# Search key — same dance against typesense-search-key-${ENV},
# then redeploy backend.
```

Verify the function and backend can still talk to Typesense by
sending a single test query through `/api/search?q=ping` and grepping
logs for `search_index_upserted` after a fresh message write.

## Schema migration

The Typesense collection name is versioned (`messages_v1`, `_v2`, …).
The active version is fronted by a `messages` alias.

1. Define the new schema. Update `docs/adr/0005-search-sidecar.md`
   with the version bump.
2. Create the new collection:
   ```sh
   curl -X POST -H "X-TYPESENSE-API-KEY: $ADMIN" \
     "$TYPESENSE_HOST/collections" -d @new-schema.json
   ```
3. Reindex into the new collection by setting
   `TYPESENSE_COLLECTION=messages_v2` and rerunning the reindex script.
4. Atomically flip the alias:
   ```sh
   curl -X PUT -H "X-TYPESENSE-API-KEY: $ADMIN" \
     "$TYPESENSE_HOST/aliases/messages" \
     -d '{"collection_name": "messages_v2"}'
   ```
5. After 30 days with no errors, delete the old collection
   (`DELETE /collections/messages_v1`).

The trigger and backend always read `TYPESENSE_COLLECTION`, which
defaults to `messages` (the alias) — so no code change is required for
the cutover.

## Cost monitoring

The Sentry alert `search_index_quota_warning` fires when the daily
write quota crosses 80% of `JACOB_SEARCH_INDEX_DAILY_CAP` (default
50_000). When you see it:

1. Inspect recent message volume in Cloud Logging:
   `resource.type="cloud_function" jsonPayload.message:"search_index_upserted"`.
2. If the spike is legitimate (campaign / new group), raise the cap
   via `JACOB_SEARCH_INDEX_DAILY_CAP=100000` and redeploy.
3. If it's a runaway loop, set `TYPESENSE_DISABLED=true` and
   investigate the trigger metrics for repeated retries on the same
   `eventId`.

## Decommissioning a group

Groups are *never* hard-deleted in v2 (archived only). If group
deletion is added later, the trigger MUST also walk the group's
messages and delete them from the index — otherwise the index will
accumulate ghosts that the per-request membership filter would
correctly hide but that consume disk forever.
