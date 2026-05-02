# Photo upload + moderation pipeline (T10)

This pipeline gates every image — message attachment or profile avatar —
behind a CSAM hash check and Cloud Vision SafeSearch before it becomes
visible to anyone but the uploader.

## Sequence

```
Client                           Backend (FastAPI)              GCS                          Cloud Vision / Hash service
  │                                    │                          │                                 │
  │  POST /api/uploads/photos          │                          │                                 │
  │  { purpose, mimeType, byteCount,   │                          │                                 │
  │    groupId? }                      │                          │                                 │
  ├───────────────────────────────────►│                          │                                 │
  │                                    │  validate (member?,      │                                 │
  │                                    │   mime, size)            │                                 │
  │                                    │  uploads/{id} = pending  │                                 │
  │                                    │  generate signed PUT URL │                                 │
  │  201 { uploadId, uploadUrl }       │  (5-minute expiry)       │                                 │
  │◄───────────────────────────────────┤                          │                                 │
  │                                    │                          │                                 │
  │  PUT uploadUrl  (image bytes)      │                          │                                 │
  ├───────────────────────────────────────────────────────────────►│ quarantine bucket               │
  │                                    │                          │                                 │
  │  POST /api/uploads/{id}/finalize   │                          │                                 │
  ├───────────────────────────────────►│                          │                                 │
  │                                    │  download bytes          │                                 │
  │                                    │◄─────────────────────────┤                                 │
  │                                    │  hash → query CSAM list  │                                 │
  │                                    ├────────────────────────────────────────────────────────────►│
  │                                    │◄────────────────────────────────────────────────────────────┤
  │                                    │  on hit:                 │                                 │
  │                                    │    quarantine_permanently│                                 │
  │                                    │    moderation_queue write│                                 │
  │                                    │    NCMEC report (stub)   │                                 │
  │  451 { csam_hash_match }           │    return 451            │                                 │
  │◄───────────────────────────────────┤                          │                                 │
  │                                    │  else: SafeSearch        │                                 │
  │                                    ├────────────────────────────────────────────────────────────►│
  │                                    │◄────────────────────────────────────────────────────────────┤
  │                                    │  on adult/violence/racy: │                                 │
  │                                    │    quarantine_permanently│                                 │
  │                                    │    moderation_queue write│                                 │
  │  422 { safesearch_blocked }        │    return 422            │                                 │
  │◄───────────────────────────────────┤                          │                                 │
  │                                    │  on pass:                │                                 │
  │                                    │    copy → public bucket  │                                 │
  │                                    │    delete from quarantine│                                 │
  │  200 { publicUrl }                 │    uploads/{id}=approved │                                 │
  │◄───────────────────────────────────┤                          │                                 │
  │                                    │                          │                                 │
  │  Firestore write: messages/{mid}   │                          │                                 │
  │    .mediaRefs += [publicUrl]       │                          │                                 │
  │  (or users/{uid}.photoURL = url)   │                          │                                 │
```

## Security boundaries

| Boundary | Enforced where |
|---|---|
| Only authenticated users can request signed URLs | `get_current_user` on `/api/uploads/photos` |
| Only group members can upload to a group | Membership check in `create_photo_upload` |
| Mime allowlist (`image/jpeg|png|webp`) | Pydantic `Literal` on `mimeType` |
| Size cap (8 MB) | Pydantic `Field(le=...)` + signed URL `Content-Length` pin + bucket rule |
| Public bucket is write-isolated | IAM: only the moderation service account has `objectAdmin` |
| Quarantine bucket is read-isolated | IAM: only the API + moderation service accounts can read |
| 5-minute expiry on signed URLs | `SIGNED_URL_TTL_MINUTES` in `services/storage.py` |
| Quarantine objects auto-expire after 90 days | `lifecycle_rule` in `infra/buckets.tf` |
| Client never receives `publicUrl` until both checks pass | Returned only from `/finalize` happy path |

## Environment variables (backend)

| Variable | Required | Purpose |
|---|---|---|
| `JACOB_MEDIA_QUARANTINE_BUCKET` | yes | Name of the quarantine GCS bucket |
| `JACOB_MEDIA_PUBLIC_BUCKET` | yes | Name of the public CDN-served bucket |
| `JACOB_HASH_SERVICE_URL` | prod | CSAM hash service endpoint (vendor TBD) |
| `JACOB_NCMEC_ENDPOINT` | prod | NCMEC CyberTipline submission endpoint |
| `JACOB_DISABLE_MODERATION` | dev only | When `true`, bypass external moderation calls |

`JACOB_DISABLE_MODERATION` makes the emulator / local tests usable
without service account credentials. **It must be unset in staging and
production.** Sentry should alert on its presence in deployed configs.

## Lawyer-review checklist

This list must be completely green before opening uploads to real users.
Any item left blank, or marked **PENDING**, blocks public launch.

- [ ] **PENDING — must complete before launch.**
- [ ] CSAM hash service vendor selected and contract signed (PhotoDNA,
      Project Lantern, or Thorn). Confirm the vendor is registered with
      NCMEC if their service is what triggers the report.
- [ ] NCMEC CyberTipline reporting credentials provisioned for the JACOB
      operating entity. Production `JACOB_NCMEC_ENDPOINT` set.
- [ ] Replace `report_to_ncmec` stub in `backend/app/services/moderation.py`
      with a real submission that includes: image bytes, uploader uid,
      uploader IP (capture in middleware before launch), upload time,
      group id, and the matching hash.
- [ ] Define and document the takedown policy for SafeSearch failures
      that aren't CSAM (e.g., racy/violence). Auto-quarantine is in
      place; what is the user notification, dispute path, and retention?
- [ ] Engage legal review of `docs/moderation-pipeline.md` and
      `firestore.rules`. Flag anything that depends on minor users
      (`users/{uid}.isMinor == true`) — heightened obligations apply.
- [ ] Verify the public bucket IAM in production: `allUsers` has
      `roles/storage.objectViewer`, and ONLY the moderation service
      account has any write/admin role. The API service account must
      NOT be in the writer list.
- [ ] Confirm bucket-level size cap and `Content-Length` enforcement
      via end-to-end test from a hostile client (curl-style) attempting
      a 9 MB PUT to a freshly-issued signed URL. Expect a 4xx from GCS.
- [ ] Audit log retention: confirm `moderation_queue` is exportable to
      cold storage on a schedule that satisfies any applicable preserva-
      tion obligations (NCMEC requires preservation for 90 days minimum
      after a report).
- [ ] Pen-test the finalize endpoint for replay / cross-user attacks:
      confirm that `uploads/{id}.uploaderUid` is checked before any
      moderation work runs.
- [ ] Verify Sentry / Cloud Logging filters strip the `publicUrl` and
      `imageHash` from any captured exception traces before they're
      ingested by third-party systems.

## Operational notes

- **Runaway-cost protection.** `check_safesearch` and
  `check_hash_service` only run on explicit `/finalize` calls — they are
  not Firestore-triggered. There is no fan-out and no retry loop, so a
  malicious uploader can at worst burn one Vision call per upload init.
  Rate limiting on `/api/uploads/photos` lands in T17.
- **Cold-start latency.** First Vision call after a Cloud Run cold start
  may exceed 1 second. The frontend shows a "Reviewing photo…" state
  during finalize so users don't think the upload hung.
- **Avatar replacement of the T05 temporary path.** T05 wrote avatars
  directly to Firebase Storage at `users/{uid}/uncheckedAvatar`. T10
  removes that path: avatar uploads now go through the same pipeline
  as message photos (`purpose: "avatar"`). The placeholder doc
  `docs/temporary-avatar-flow.md` has been deleted.
