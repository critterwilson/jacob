# JACOB

**Small Group Messaging Platform**

*Concept Overview · Product Requirements · Feature Roadmap*

Prepared by Christopher Wilson — April 2026
*Revision 2 — architecture, audience, and Phase 1 scope updated after review*

---

## Part 1: Concept Overview

### Vision

JACOB is a faith-centered, small-group messaging platform built to help communities communicate with intention, accountability, and authenticity. It gives groups a structured space to share needs, offer help, and grow together — guided by built-in tools that make meaningful engagement the default, not the exception.

The long-term vision extends beyond messaging: JACOB becomes the connective tissue for small group culture — a brand and platform under which independent groups can discover one another, share resources, and build something larger than themselves.

### The Name: JACOB

In Hebrew, Jacob means "one who grabs at the heel" — a grappler. He is the first recorded example of wrestling in Scripture (Genesis 32), a man who fought for blessing and was transformed in the struggle. The name carries themes of persistence, community, and identity forged through challenge.

The name resonates in two worlds: Christian small groups (where the biblical reference is immediate) and BJJ gyms (where grappling is central to identity). Phase 1 leads with the Christian audience because the pilot groups are already lined up and the sticker taxonomy maps cleanly to small-group dynamics. BJJ expansion is planned for Phase 3, after the core mechanic is validated, and will require its own sticker set and brand-voice tuning.

**As an acronym:** JACOB stands for **Joint Asynchronous Congregation of Believers** — "asynchronous" being the literal technical mode of small-group messaging (people don't have to be present at the same time), and "congregation of believers" capturing the spiritual identity of the platform.

### Core Philosophy

- **Forced authentic engagement:** the sticker system ensures messages are tagged by intent (prayer, help, praise, etc.), driving real interaction rather than passive scrolling.
- **Guided communication:** the platform gives users a framework for what to say and how — reducing noise and increasing depth.
- **Cross-group visibility without cross-group noise:** groups can browse other groups' feeds (read-only), but cannot reply inside another group's chat. Message boards provide a neutral space for inter-group communication.
- **Minimal design:** the interface should be clean and uncluttered. The value is in the relationships and content, not the UI chrome.

### Target Audience

#### Phase 1 (launch): Christian small groups

The original use case. Pilot groups are committed. Sticker categories — prayer, testimony, service — map directly to small-group dynamics. The "playbook" vision originated here. Christian small groups (men's groups, Bible studies, cell groups) need a communication layer that goes beyond a group text thread; JACOB provides structure, intentionality, and cross-group community.

#### Phase 3 (expansion): BJJ gyms

Tight-knit communities with strong group identity and a culture of trust and accountability — a natural fit for JACOB's structure. The Jacob/heel-hook connection gives the brand authentic credibility once positioned for that audience. Onboarding BJJ gyms requires a separate sticker set (e.g., "Need a roll partner," "Tournament prep," "Recovery"), a brand voice that doesn't lean into faith content, and likely partnership pilots with one or two gyms before a public push.

#### Future: general community groups

Sports teams, recovery groups, neighborhood orgs, and other tight-knit communities that value intentional communication.

### Long-Term Vision

The original concept behind JACOB was a paper binder — a guide passed from one group leader to the next explaining how to build a successful men's group. JACOB digitizes and scales that idea:

- Groups can publish a "playbook" — their culture, rituals, values, and practices — that other groups can discover and adapt.
- Groups can unite under a shared brand or network, creating a federated community of communities.
- JACOB becomes the platform that makes small group culture portable and scalable.

---

## Part 2: Product Requirements

### User Roles & Permissions

| Role         | Permissions                                                                                                  | Notes                                            |
|--------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| Member       | Post in own group chat, use stickers, view other group boards (read-only, Phase 2)                           | Core user; onboarded via invite or group code    |
| Group Leader | All Member permissions + invite members, pin messages, set group description, post announcements             | Accountable for group culture and moderation     |
| Moderator    | Flag/remove content, mute/ban users, review reported content                                                  | Platform-level role; responds to reports         |
| Admin        | Full platform access, analytics, user management, content policies                                            | Internal JACOB team                              |

### Core Feature Requirements

#### 1. Account Creation

Account creation should be intentional and thorough — this is a community platform, not a casual app. A complete profile builds trust.

- Required: name, email, profile photo
- Optional but encouraged: phone, interests, faith background, BJJ rank/gym affiliation (Phase 3), location (city-level)
- Users accept community guidelines during onboarding
- Group membership is invite-only or via group code
- **Minimum age: 13.** No accounts under 13 (COPPA exposure). Users under 18 receive restricted defaults: no public profile discovery, no cross-group DMs, uploads visible only inside their group until reviewed. This is a defensive posture, not a verified-age system; a formal flow (e.g., Stripe Identity) is available later if abuse appears.

#### 2. Group Chat

Each small group has its own private, persistent chat channel. Slack is the UX reference for messaging — particularly threading, notification control, and feed clarity.

- Text messages and photos supported (video upload moves to Phase 2)
- Every top-level message must carry at least one sticker (see Sticker System)
- Threaded replies: any top-level message can have a thread of replies (Slack-style)
- Thread reply count is shown on the parent message ("5 replies") — social signal without flooding the main feed
- Users are notified about a thread only if they posted in it or explicitly followed it
- Optional "also post to channel" when replying in a thread, to surface key replies back to the main feed
- **Sticker semantics:** the sticker tags the intent of the top-level message; thread replies inherit that intent and do not require their own sticker. (Open: revisit if leaders want sub-tagging in threads.)
- Group Leader can pin messages, set a group description, and post announcements
- Chat history is retained and searchable via the search sidecar (Algolia/Typesense)
- Notifications: in-app + email digest in v1; push notifications via FCM in Phase 3

#### 3. Sticker System

Stickers are the heart of JACOB's "forced authentic engagement" mechanic. Users tag every top-level message with a sticker that categorizes its intent. This creates a filterable, meaningful feed rather than a noisy chat log.

| Sticker         | Use Case                                                |
|-----------------|---------------------------------------------------------|
| Prayer Request  | I need prayer for something specific                    |
| Offering Help   | I have a skill, resource, or time to give               |
| Need Help       | Practical need — rides, meals, moving, etc.             |
| Praise Report   | Sharing a blessing or answered prayer                   |
| Check-In        | Casual update — how I'm doing (default sticker)         |
| Event / Meetup  | Organizing in-person or virtual group time              |

Stickers are required on top-level posts. Users may select up to two stickers per message. "Check-In" is the default if a user does not choose. Moderators can add or retire categories over time.

BJJ gyms (Phase 3) will receive a parallel sticker set tailored to gym dynamics (rolls, training, tournaments, recovery). Sticker sets are configurable per group/tenant.

#### 4. Photos and Media (Phase 1: photos only)

Photos are supported in Phase 1. Video upload is deferred to Phase 2 to limit storage cost, transcoding complexity, and moderation surface area.

Every uploaded photo flows through automated moderation before becoming visible to anyone other than the uploader:

- Cloud Vision SafeSearch — flags adult, violence, racy, and medical content
- Hash matching against known CSAM (Thorn's Safer or PhotoDNA-equivalent service). Matches trigger immediate quarantine and a NCMEC report
- On flag: image is held in a private moderator-only bucket until reviewed; user is informed their upload is pending

**This is non-negotiable and ships with photo upload, not after.** US-hosted user-generated-content platforms have reporting obligations under 18 U.S.C. § 2258A. Get the moderation pipeline reviewed by a lawyer familiar with NCMEC reporting before opening uploads to real users.

#### 5. Cross-Group Visibility & Message Boards (Phase 2)

Moved out of Phase 1. In Phase 2: any user can browse the public chat feeds of other groups (read-only); message boards (forums) provide a shared space across groups; board posts also require sticker tags; Group Leaders can choose to make their group fully private (members only).

#### 6. Content Feed

- Daily Bible verse displayed on the home screen (Phase 2 — automated)
- Embedded video content (YouTube/Vimeo) and native uploads in Phase 2
- Content is surfaced per-group or platform-wide depending on who posted

#### 7. Welcome / Home Page

- Primary navigation: Chats, About/FAQ in Phase 1; Forums added in Phase 2
- Maintenance mode banner (planned downtime)
- Highlight reel of recent activity across groups (Phase 2, read-only)
- Quick access to group playbooks (Phase 4)

#### 8. About & FAQ Pages

- About: brand story, mission, the Jacob name, team info
- FAQ: how groups work, what stickers are for, moderation policies, data and privacy

#### 9. Reporting (Phase 1: Google Form)

Phase 1 uses an external Google Form for in-app reports. Each reportable surface (message, profile, group) carries a "Report" link that opens the form pre-filled with a content ID. Reports land in a Google Sheet that moderators triage daily.

This avoids building a reporting UI, queue, and review tool for v1. A native in-app reporting flow + moderation queue ships in Phase 2.

### Security & Moderation Requirements

#### Encryption

- All data in transit: TLS 1.3 minimum
- Data at rest: Firestore and Cloud Storage are AES-256 encrypted by default
- **Message content: server-side encryption only.** E2EE is not used — JACOB's value proposition is community visibility and active moderation, which requires the platform to be able to read content. Clearly disclosed in the privacy policy: messages are visible to group members and platform moderators.

#### Authentication

- Firebase Authentication (email/password + Google sign-in)
- Session tokens with short expiry + refresh tokens
- Rate limiting on auth endpoints to prevent brute force
- Optional 2FA (authenticator app) available at signup; required for Group Leaders and Moderators in Phase 1

#### Rate Limiting

- Auth endpoints: 5/min per IP
- Posting: 30 messages/min, 10 uploads/hour per user (mitigates compromised accounts)
- Group invites: capped per leader per day
- Reports: capped per user per day to discourage harassment via the report channel

#### Content Moderation

- Text: Cloud Natural Language API — toxicity and hate-speech detection on all text posts
- Photos: Cloud Vision SafeSearch + CSAM hash match (mandatory pre-publish scan)
- User reporting: Google Form (Phase 1) → in-app queue (Phase 2)
- Manual review SLA: 24 hours for flagged content
- Escalation policy: warn → mute (24h / 7d) → ban. Severe violations → immediate ban + NCMEC report where applicable
- Appeals: one written appeal via email

#### Account Deletion & Data Lifecycle

- Users can request account deletion in-app. On confirmation: account is marked deleted and the user is logged out everywhere
- 14-day grace window allows reversal; after 14 days, deletion is permanent
- Authored messages are tombstoned with "[deleted user]" rather than hard-deleted, to preserve thread continuity. Users may opt for hard-delete of their message content (not the message stub) at deletion time
- Profile data, uploads, and PII are hard-deleted after the grace window
- GDPR/CCPA: data export within 30 days of request; deletion within 30 days

#### Age Policy

- Minimum age 13. Self-attested at signup; suspected minors can be challenged for verification
- Under-18 users have restricted defaults (no public profile, no cross-group DMs, uploads moderated more strictly)
- Formal age verification (e.g., Stripe Identity) available as a future option if abuse appears

#### Advertising & Data

- No third-party advertising. JACOB is ad-free by design.
- User data is not sold or shared with third parties.
- GDPR/CCPA-aware: user data export and deletion available on request.

### Technical Architecture

The original plan combined Postgres on Cloud SQL with Firebase Realtime Database for messaging. That hybrid added two backup stories, two access-control models, and dual-write consistency problems. The revised plan commits to Firebase + Firestore as the single data layer for v1, with FastAPI on Cloud Run handling non-realtime APIs (uploads, moderation hooks, admin operations).

Rationale: Firestore gives real-time sync, offline support, mobile-friendly SDKs, and security rules out of the box. One source of truth, one backup story, one access-control model. The trade is SQL ergonomics and complex query power for operational simplicity and a faster v1.

**Implications worth tracking:**

- **Search.** Native Firestore query is limited. Full-text search uses a sidecar — a Cloud Function fans message writes to Algolia or Typesense Cloud.
- **Reporting / analytics.** Beyond per-document queries, use the native Firestore → BigQuery scheduled export. Aggregations and leader analytics live there.
- **Cost.** Firestore prices per read/write/document. Use tightly-scoped onSnapshot listeners (single group, recent messages only) and paginate aggressively. Revisit if a single group exceeds ~10K messages/day. *[Historical — implemented as HTTP polling post-M6; no onSnapshot in the browser.]*
- **Vendor lock-in.** Firestore is a Google-only product. Migration to Postgres later is non-trivial. Acceptable for a v1 commitment given the speed-to-market win.

#### Stack

| Layer                  | Technology                                            | Rationale                                                                                       |
|------------------------|-------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Real-time data         | Cloud Firestore                                       | Single source of truth; native real-time sync; security rules; offline support; BigQuery export |
| Auth                   | Firebase Authentication                               | Email/password + Google sign-in; integrates natively with Firestore security rules              |
| Backend API            | Python (FastAPI) on Cloud Run                         | Non-realtime endpoints: media upload, moderation hooks, admin ops, scheduled jobs               |
| File storage           | Google Cloud Storage                                  | Photos via signed URLs; SafeSearch + hash check before write commits to bucket                  |
| Text moderation        | Cloud Natural Language API                            | Auto-flag toxicity / hate speech                                                                |
| Image moderation       | Cloud Vision SafeSearch + CSAM hash service           | Mandatory pre-publish gate on every uploaded image                                              |
| Search                 | Typesense (self-hosted on Cloud Run)                  | Native Firestore query is limited; Cloud Function fans writes to the Typesense sidecar (ADR 0005) |
| Email                  | SendGrid                                              | Transactional: verification, password reset, weekly digest                                      |
| Analytics (Phase 2)    | BigQuery (Firestore export)                           | Sticker engagement breakdowns, group-health metrics                                             |
| Push (Phase 3)         | Firebase Cloud Messaging                              | Cross-platform, free tier sufficient for early growth                                           |
| Mobile (Phase 3)       | React Native + Expo, EAS builds                       | Single codebase for iOS/Android; OTA updates; cloud builds (no Mac required)                    |
| Hosting (web frontend) | Firebase App Hosting                                  | SSR via managed Cloud Run; deploys from GitHub; aligns with Firebase Auth + Firestore           |

#### Deployment

- Docker container for the FastAPI service; pushed to Google Artifact Registry
- Cloud Run for the API; scales to zero in v1. Raise min-instances if cold starts hurt UX
- Firestore handles real-time without server management
- Firebase App Hosting for the web frontend (SSR, deploys automatically from GitHub)
- CI/CD: GitHub Actions → Cloud Run + Firebase App Hosting + Firebase Functions + Firestore (no Cloud Build step — image built directly in the Actions runner)
- Secrets in Google Secret Manager. Never check secrets into GitHub

### Observability & Reliability

- Cloud Logging + Cloud Monitoring for the API
- Sentry (free tier) for error tracking on web frontend and FastAPI service
- Uptime checks on the public site and the API health endpoint
- Error budget: aim for 99.5% monthly uptime in v1
- **Backups:** daily automated Firestore export to a Cloud Storage bucket with 30-day retention; weekly export held for 90 days. Cloud Storage media bucket has object versioning enabled.
- Quarterly restore drill. Document RTO/RPO once paying users exist

### Email & Notifications

- Transactional email via SendGrid or Postmark (verification, password reset, moderation actions, deletion confirmations)
- Weekly digest in Phase 2 (Cloud Scheduler + Pub/Sub fan-out)
- Push notifications via FCM in Phase 3

### Cost Estimate (rough, v1)

Assumptions: 10 groups × 30 users × 50 messages/day, plus modest media usage. Costs grow superlinearly with active groups; revisit at 50+ groups or 5K+ daily messages.

| Item                                                  | Monthly (USD)                          |
|-------------------------------------------------------|----------------------------------------|
| Firestore reads / writes / storage                    | $5–25 (scales with active users)       |
| Cloud Run (FastAPI)                                   | $0–10 (scale-to-zero)                  |
| Cloud Storage (photos)                                | $1–5                                   |
| Cloud Vision SafeSearch                               | $1–5 (~$1.50 / 1K images)              |
| Cloud Natural Language API                            | $1–5                                   |
| Search (Algolia free tier or Typesense Cloud entry)   | $0–25                                  |
| Email (SendGrid free or starter)                      | $0–20                                  |
| Domain + SSL                                          | ~$1                                    |
| Sentry (free tier)                                    | $0                                     |
| **Estimated v1 total**                                | **~$10–95**                            |

---

## Part 3: Feature Roadmap

Phases organize the work around proving the core communication loop before investing in cross-group features or a mobile app.

| Phase                         | Features                                                                                                                                                                          | Goal                                                                                                            |
|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| Phase 1 — MVP (0–3 months)    | Group chat + threading, sticker system, photo uploads with moderation pipeline, account creation, welcome page, Google Form reporting, basic admin dashboard                      | Prove the core loop with 2–3 Christian small-group pilots: guided, categorized communication beats a group text |
| Phase 2 — Community (3–6 mos) | Cross-group message boards + read-only browsing, native in-app reporting + moderation queue, Bible verse feed, video uploads with moderation, sticker analytics, group discovery  | Connect groups to each other; build the "united under a brand" layer                                            |
| Phase 3 — Growth (6–12 mos)   | React Native + Expo mobile app, EAS builds, FCM push, Stripe web subscriptions, BJJ gym onboarding (separate sticker set + brand voice), advanced moderation, content tools       | Reach users where they are; expand to BJJ audience; sustainable revenue                                         |
| Phase 4 — Platform (12+ mos)  | Org/network layer, playbook distribution (digital binder), inter-org events, group-health analytics, third-party API                                                              | JACOB as infrastructure for building and replicating successful small group culture                             |

### Phase 1 — MVP (0–3 Months) — Christian Small Groups

Goal: a working web app that two or three pilot groups use daily. Prove the sticker system creates better engagement than a group text.

- User registration and profile creation (Firebase Auth)
- Group creation and invite/code flow
- Group chat with required sticker tagging
- Slack-style threading on top-level messages
- Photo uploads with mandatory SafeSearch + CSAM hash check
- Welcome page with navigation (Chats, About/FAQ)
- Reporting via Google Form (deferred from native UI)
- Basic admin dashboard (user/group management, ban/unban, manual review of flagged items)
- Hosted on Cloud Run + Firestore + Firebase Auth + Cloud Storage
- Cloud Logging + Sentry from day one
- Daily Firestore backup; quarterly restore drill

**Cuts from prior Phase 1:** native in-app reporting UI (replaced by Google Form), cross-group browsing (moved to Phase 2), video uploads (moved to Phase 2).

### Phase 2 — Community (3–6 Months)

- Cross-group message boards (public forums with sticker tags)
- Cross-group chat visibility (read-only browsing of other groups)
- Native in-app reporting + moderation queue
- Bible verse feed (daily, automated)
- Video uploads with Cloud Video Intelligence moderation
- Embedded video content (YouTube/Vimeo)
- Sticker analytics for leaders (BigQuery-backed)
- Automated text moderation (Cloud Natural Language API)
- Group discovery page

### Phase 3 — Growth (6–12 Months)

Goal: reach users where they are, expand to BJJ, build a sustainable business.

- **Mobile app (iOS + Android) with React Native + Expo.** Expo handles builds, device testing, and app store submissions via EAS. No Mac required for iOS builds. OTA updates ship JS fixes without app-store review.
- Push notifications via FCM (free, both platforms)
- App store accounts: Apple Developer Program ($99/year), Google Play ($25 one-time)
- **BJJ gym onboarding:** BJJ-specific sticker set, brand voice variants, partnership pilot with one or two gyms before public push. Allocate real product time — not a copy pass.
- **Monetization:** start with web subscriptions via Stripe. Apple/Google in-app purchase rules are still volatile post-Epic v. Apple; treat IAP as a separate decision once a paid web tier is converting.
- Advanced moderation tools (escalation tracking, ban history)
- Content creation tools (announcements, scheduled posts)
- User interest matching (suggest relevant groups)

### Phase 4 — Platform (12+ Months)

Goal: JACOB becomes the infrastructure for small group culture.

- Organization/network layer: multiple groups can form a network under a shared brand
- Digital playbook: groups can publish and share their culture guide
- Inter-group events and coordination
- Analytics for group health and engagement trends
- API for third-party integrations (church management software, gym apps)

### Monetization

Monetization should be introduced carefully to protect community trust. Options to evaluate:

- Freemium: free for individual groups up to N members; paid tier for larger groups or networks
- Organization plan: paid tier for a network of groups (e.g., a church with 10 small groups)
- Premium features: advanced analytics, custom branding, playbook publishing tools
- One-time founding-group pricing for early adopters

What JACOB will not do: display ads, sell user data, or charge individual users for basic messaging.

---

## Decisions Log

Resolved items from the prior plan, plus new resolutions from this revision.

### Resolved (carried over)

- **Encryption:** server-side only (no E2EE). JACOB is a community visibility platform, not a private messaging app. TLS in transit + AES-256 at rest.
- **Sticker system:** required on every top-level message; "Check-In" is the default.
- **Threading:** Slack-style threading in Phase 1. Reply counts on parents; opt-in notifications.
- **Bot/identity protection:** invite-only model + reCAPTCHA v3 + optional phone verification. Stripe Identity available as escalation if abuse appears.
- **Pilot groups:** Christian small groups confirmed. Treat as design partners; structured feedback at the 2-week mark.

### New / revised in this pass

- **Architecture:** all-Firestore for v1, with FastAPI on Cloud Run for non-realtime APIs. Replaces the prior Postgres + Firebase Realtime DB hybrid. Firebase Realtime DB is no longer the right default for new apps.
- **Launch audience:** Christian small groups for Phase 1. BJJ deferred to Phase 3 with its own sticker set and brand-voice work.
- **Phase 1 media:** photos only. Video deferred to Phase 2.
- **Phase 1 reporting:** Google Form, not in-app. Native flow ships in Phase 2.
- **Cross-group browsing:** Phase 2 (moved out of Phase 1).
- **Image moderation:** Cloud Vision SafeSearch + CSAM hash matching ship with photo upload, not after.
- **Account deletion:** tombstone authored content; 14-day grace; profile and PII hard-deleted after grace.
- **Age policy:** 13+ minimum (COPPA); restricted defaults under 18.
- **Search:** Typesense self-hosted on Cloud Run as a sidecar; Cloud Function fans Firestore writes. Vendor decided in ADR 0005.
- **Backups:** daily Firestore export, 30-day retention; weekly held 90 days; media bucket versioning.
- **Observability:** Cloud Logging + Sentry from day one.
- **Email:** SendGrid or Postmark for transactional mail.

### Open decisions

- Sub-tagging in threads (whether replies can carry their own sticker for finer-grained filtering). Default for v1: no, replies inherit parent sticker.
- ~~Search vendor~~ — **decided**: self-hosted Typesense on Cloud Run (ADR 0005).
- Phase 3 sticker set for BJJ gyms: design with at least one pilot gym.
- When (and whether) to add native iOS/Android in-app purchase. Re-evaluate Apple/Google policy state at the time of Phase 3.

## Open Risks & Things to Watch

- **Firestore cost at scale.** Per-doc pricing scales with active reads; revisit at 50+ groups or if read costs cross $50/month.
- **Search infra cost.** Typesense on Cloud Run (ADR 0005). Validate at scale; Cloud Run min-instances cost is the main lever.
- **CSAM compliance.** Reporting obligations under 18 U.S.C. § 2258A are not optional. Get the moderation pipeline reviewed by a lawyer familiar with NCMEC reporting before opening uploads.
- **Apple/Google IAP rules (Phase 3).** Anti-steering rules are still moving. Don't bake the business model around web-only checkout assumptions; revisit when monetization ships.
- **Brand-audience tension.** Christian-coded sticker categories will not translate to BJJ. Phase 3 onboarding for gyms must include a separate sticker set and brand-voice variant.
- **Solo-dev capacity.** Phase 1 is still ambitious. If at the 6-week mark the chat + sticker loop is not usable end-to-end, drop the admin dashboard before adding features — direct Firestore console + a small CLI is acceptable for two pilot groups.

---

> *"Wrestling is the oldest sport. Community is the oldest need."*
> — JACOB
