# Runbook — Typesense image digest pin (L11)

The Typesense sidecar (see `docs/adr/0005-search-sidecar.md`) is pinned by
**both** a human-readable tag (`27.1`) **and** an immutable SHA digest
(`sha256:…`). Docker uses the digest as the trust anchor when both are
present, so a re-tag of the same version on Docker Hub cannot silently swap
the running image.

The digest is **required** in Terraform — `terraform apply` rejects an empty
or malformed `typesense_image_digest`.

## Where the pin lives

- `infra/typesense.tf` — defines `typesense_image_tag` + `typesense_image_digest`
  variables, joins them as `typesense/typesense:${tag}@${digest}` for Cloud
  Run.
- `infra/terraform.staging.tfvars.example` — example values; copy to
  `terraform.staging.tfvars` (gitignored) and customise.
- `.github/dependabot.yml` — has a forward-looking docker entry on `/infra`
  with `reviewers: [critterwilson]`. **Heads-up:** Dependabot's docker
  ecosystem only scans Dockerfiles, not Terraform image strings, so this
  entry is a no-op today; the digest is rotated manually.

## Looking up a digest

Two equally good options:

### Option A — `crane` (preferred when available)

```bash
brew install crane            # one-time
crane digest typesense/typesense:27.1
# → sha256:5c12af89130b8ee0be11541321ba8a3a7c7a538d7c6cd95e0409dc2d75ca6455
```

### Option B — Docker Hub API (no install needed)

```bash
curl -s "https://hub.docker.com/v2/repositories/typesense/typesense/tags/27.1/" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"])'
# → sha256:5c12af89130b8ee0be11541321ba8a3a7c7a538d7c6cd95e0409dc2d75ca6455
```

Either way, paste the returned `sha256:…` into `typesense_image_digest`.

## Bumping the version

1. Pick the new tag from <https://hub.docker.com/r/typesense/typesense/tags>
   — Typesense uses major-version tags `27.x`, `28.0`, `29.1`, `30.2`, etc.
   Avoid `*.rc*` release-candidates in production.
2. Look up the digest using either option above.
3. Update `typesense_image_tag` and `typesense_image_digest` in
   `terraform.<env>.tfvars` (and the `.example` defaults if the new pin
   should become the team's recommended baseline).
4. Run `terraform plan` — expect a single `image` change on
   `google_cloud_run_v2_service.typesense`. No other drift.
5. Read the upstream release notes for breaking changes between the old
   and new major versions; back up the data bucket before applying if the
   bump crosses a major boundary.
6. `terraform apply` deploys the new image. Cloud Run rolls one revision
   forward; the previous revision is retained for instant rollback.

## Rollback

```bash
gcloud run services update-traffic typesense-staging \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=us-central1
```

Or revert the tfvars change and re-apply.

## Why we don't auto-bump via Dependabot

Dependabot's docker ecosystem reads Dockerfiles. The pinned image lives in
HCL (`var.typesense_image_tag` joined into a `google_cloud_run_v2_service`
resource), which Dependabot cannot parse. We could add a placeholder
Dockerfile in `/infra` purely to give Dependabot something to scan, but
that introduces a second source of truth for the image reference and was
judged not worth the maintenance load.

The practical replacement is: this runbook + a calendar reminder to look
up the digest quarterly (or whenever a CVE drops for Typesense).
