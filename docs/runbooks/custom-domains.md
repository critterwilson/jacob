# Custom domains runbook (T55)

## What this covers

Two ways an org can address its workspace:

1. **JACOB subdomain** — `our-church.jacob.app`. Free, claim-and-go,
   no DNS work for the org admin.
2. **Custom (vanity) domain** — `groups.our-church.org`. Org owns
   the domain; we provision a managed cert via Cloud Run.

Both flows run through `/api/orgs/{orgId}/...` endpoints and are
gated to org admins. The frontend middleware (`frontend/middleware.ts`)
resolves a host to an org via the unauthenticated
`GET /api/by-host?host=X` endpoint and attaches `x-jacob-org-*`
headers for the rest of the render.

## Prerequisites (one-time, for the platform)

* DNS A/AAAA record for `*.jacob.app` pointing at the Cloud Run /
  Firebase App Hosting endpoint.
* A wildcard managed cert covering `*.jacob.app`.
* Identity Platform `authorized-domains` list contains `jacob.app`
  and an entry per claimed vanity domain (added per-claim — see the
  manual operator step below).

## Subdomain claim flow

1. Org admin opens `/orgs/{orgId}/settings` → "JACOB subdomain"
   card.
2. Types a name (3–40 chars, lowercase, hyphens allowed but not
   leading / trailing).
3. Backend validates against `JACOB_RESERVED_SUBDOMAINS`
   (current default: `api,www,admin,status,dashboard,help,blog,
   mail,smtp,imap,ns1,ns2,app,auth,docs,static,support,internal,
   platform`).
4. `domain_claims/{<sub>.jacob.app}` is created atomically (single-
   doc `create` is the uniqueness primitive). The org's
   `customSubdomain` field is updated.
5. Subsequent visits to `<sub>.jacob.app` are resolved by the
   middleware via `/api/by-host`. Cache TTL is 5 minutes.

**Failure modes**

* `400 invalid_subdomain` — regex didn't match.
* `409 reserved_subdomain` — the name is on the reserved list. Add
  to `JACOB_RESERVED_SUBDOMAINS` env var if a new platform service
  needs to reserve a name.
* `409 domain_taken` — another org claimed it. Currently no
  arbitration mechanism; document the cooling-off / appeal process
  if a real conflict arises.

## Custom domain claim flow

1. Org admin opens settings, enters their hostname (e.g.
   `groups.our-church.org`).
2. Backend issues a TXT record value
   (`jacob-domain-verify=<random>`) and persists it on
   `orgs/{orgId}.customDomain` with `status: pending`.
3. UI shows the TXT record and the target host. Org admin adds it
   to their DNS provider. Recommend TTL ≤ 300 s for first-time
   setup so the verification can succeed quickly.
4. Org admin clicks "Re-check status" → `GET /api/orgs/{orgId}/
   custom-domain/status` → backend queries DNS via `dnspython`. On
   match, `status` flips to `verified` and `certStatus` to
   `provisioning`.
5. **Manual operator step** (logged via Sentry / Cloud Logging as
   `MANUAL_ACTION_REQUIRED`):

   ```bash
   gcloud run domain-mappings create \
     --service jacob-backend \
     --domain groups.our-church.org \
     --region us-central1
   ```

   Cloud Run takes 5–30 minutes to provision the managed cert.
   When the cert is active, manually update
   `orgs/{orgId}.customDomain.status = "active"` and
   `certStatus = "active"` (admin SDK; no UI today).
6. **Firebase Auth authorized-domains**: also add the new origin to
   the Firebase Auth authorized-domains list. JACOB uses the
   single-tenant Firebase Auth surface (not the Identity Platform
   tenant model), so the `gcloud identity-platform tenants update`
   command does **not** apply here. Update via:

   - **Firebase Console** (recommended): Authentication → Settings
     → "Authorized domains" tab → "Add domain" → enter
     `groups.our-church.org` → Save. Repeat per claimed vanity
     domain.
   - Or via the Identity Toolkit Admin REST API
     (`projects.updateConfig`) on the project's
     `authorizedDomains` field, which is the same setting under a
     different surface.

   Without this, OAuth sign-in (Google) fails on the new origin
   with `auth/unauthorized-domain`.

## "TLS still pending after 4 hours" failure mode

1. Confirm the operator ran the `gcloud run domain-mappings create`
   step. If not, run it now.
2. `gcloud run domain-mappings describe --domain <hostname>
   --region us-central1` should show the cert state. Common
   problems:
   * **DNS not pointing at Cloud Run.** The org admin needs to add
     a CNAME (or A record set) to whatever Cloud Run reports in
     `resourceRecords`. Until that DNS lands, cert provisioning
     can't complete.
   * **CAA record blocking Let's Encrypt.** If the org's domain has
     a CAA record that doesn't list `letsencrypt.org` /
     `pki.goog`, Google can't issue a cert. Org admin removes the
     CAA or adds the issuer.
3. If still stuck after 24 hours, delete the mapping and recreate.
4. Sentry alerts on `cert_provisioning_failed` events; the on-call
   plays this runbook from the top.

## Cookie scope (security-relevant)

* Firebase Auth's session cookie is set with `domain=.jacob.app`,
  so signing in once on any subdomain logs you in across every
  `*.jacob.app` workspace. This is *intentional* — the SSO UX
  expects one session per browser.
* **Vanity domains are isolated.** A user signed in on `jacob.app`
  is NOT signed in on `groups.our-church.org` — the cookie scope
  doesn't extend across domains. They sign in separately on the
  vanity host. This is also intentional: it's the only way to
  prevent an org admin who claims a domain from observing the
  user's session cookie via JS on their custom origin.
* **WebAuthn passkeys** are bound to the RP id (parent domain).
  Passkeys registered on `jacob.app` work on any `*.jacob.app`
  subdomain. Passkeys registered on `groups.our-church.org` only
  work on that origin.

These trade-offs are documented at the bottom of the org settings
page — visible to the admin before they claim.

## Releasing a domain

* Subdomain: `DELETE /api/orgs/{orgId}/subdomain`. The
  `domain_claims/{hostname}` doc is *not* deleted — `releasedAt` is
  set. Re-claim is blocked for 30 days (cooling-off; prevents
  squat-after-pivot abuse). To overrule, an operator deletes the
  claim doc directly.
* Vanity: `DELETE /api/orgs/{orgId}/custom-domain`. Same shape.
  An operator should also remove the Cloud Run domain mapping and
  the Identity Platform authorized-domain entry.

## What's NOT in v1

* Wildcard subdomains *under* an org's vanity domain
  (e.g. `*.our-church.org` per-group hosts).
* Auto-provisioning the Cloud Run domain mapping from the API.
  Requires giving the backend service account `run.admin` on the
  Cloud Run service, which expands the blast radius beyond what
  T55 needs.
* Auto-managing the Identity Platform authorized-domains list.
  Requires `identitytoolkit.admin` IAM on the backend.
* Multi-region cert provisioning.
* CAA record auto-provisioning on the org admin's behalf.
