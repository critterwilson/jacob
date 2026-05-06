## In plain words

JACOB is a small messaging app for Christian small groups. We collect the
information you give us to help your group stay in touch — your email, your
display name, your messages, the photos you choose to share. We don't sell it,
we don't share it with advertisers, and we use it for the smallest set of
things needed to run the service. You can read your data, fix it, export it,
or delete your account at any time. The rest of this page spells out the
specifics.

*Effective: [DATE TO BE SET ON LAUNCH]*

## What we collect

When you create an account, we collect:

- **Account information** — your email address and a password (or your Google
  account, if you sign in with Google).
- **Profile information** — the display name you choose, an age group (so we
  know whether you are under 18), and an optional profile photo.
- **Optional profile fields** — phone number, city, and a short faith
  background, only if you fill them in. You can leave them blank.

While you use the service, we collect:

- **Messages and posts** — the chat messages, board posts, photo uploads,
  reactions, and replies you create inside your groups.
- **Group membership** — which groups you belong to and your role in each
  group (member or leader).
- **Push notification preferences** — whether you've opted in, and the device
  token your browser provides for delivery.
- **Mute and block lists** — the people you've muted or blocked so we can
  honor those choices.
- **Basic operational logs** — the time of a request, the action it took, and
  enough technical detail to investigate problems. We never log full message
  bodies in operational logs; we log message IDs and lengths.

## How we use it

We use this information only for what's needed to run JACOB:

- Sign you in and keep your session alive.
- Deliver messages, posts, and notifications to the people in your group.
- Apply automatic and human moderation to keep the community safe.
- Send transactional email (sign-up verification, password reset, account
  deletion confirmation, security notices).
- Investigate abuse reports and respond to legal process where required.
- Improve the service with aggregate, non-identifying usage data.

We do **not** sell your information, share it with advertisers, train AI
models on your private messages, or run third-party tracking pixels or ad
networks against your activity in the app.

## Who we share it with

We share data only with service providers that help us run JACOB, and only
the minimum each one needs:

- **Firebase Authentication, Cloud Firestore, and Cloud Storage** (operated
  by Google LLC) — we use these to host your account, store your messages,
  and serve your photos. They process data on our behalf under their data
  processing terms.
- **Google Cloud Run, Logging, and Monitoring** (operated by Google LLC) —
  we run our backend and observability stack here. Cloud Logging holds
  short-lived operational logs.
- **SendGrid** (operated by Twilio Inc.) — we use SendGrid to deliver
  transactional email such as verification, password reset, and security
  notices. SendGrid does not use your address for marketing.
- **Cloud Vision and Cloud Natural Language APIs** (operated by Google LLC)
  — we send uploaded images and the text of new messages to these APIs for
  automated safety classification. Results are returned to us and not used
  by Google to improve their products.
- **NCMEC (National Center for Missing & Exploited Children)** — if our
  systems flag content that matches a known child sexual abuse material
  (CSAM) hash, we are legally required to report it to NCMEC. We share only
  what is required by law (the offending content, the account, and basic
  context). This is the only routine third-party reporting path in JACOB.
- **Law enforcement** — we will respond to valid legal process (subpoena,
  warrant, court order) and to good-faith requests where we believe a person
  is in immediate physical danger. We will resist overly broad requests.

We never share with advertisers, data brokers, or analytics vendors that
use your data for their own products.

## Where it's stored

JACOB runs on Google Cloud infrastructure in the United States. If you
access JACOB from outside the United States, your information will be
transferred to and processed in the United States.

## How long we keep it

We keep your data while your account is active. When you delete your
account:

- Your profile, messages, posts, photos, reactions, and group memberships
  are removed in a cascading deletion (this is the *right to be forgotten*
  / Article 17 of the GDPR).
- The deletion is performed within 30 days of your request. Some references
  to your prior content (for example, in another member's quoted reply)
  are replaced with a generic "deleted user" placeholder rather than your
  name.
- Operational logs that mention your account ID are kept for up to 90 days
  for security and abuse investigations, then expire automatically.
- Audit log entries that record significant moderation events (such as a
  ban or a CSAM report) are retained as required by law and our moderation
  policy.

## Your rights

You have the right to:

- **Access** the personal information we hold about you (use the data
  export feature in account settings).
- **Correct** inaccurate information (edit your profile in account
  settings).
- **Delete** your account and the data tied to it (use the delete-account
  flow in account settings).
- **Export** a portable copy of your data (use the data export feature).
- **Object** to specific processing or **withdraw consent** where the
  processing relies on your consent (contact us using the address below).
- **Lodge a complaint** with your local data-protection authority if you
  are in a jurisdiction that provides one.

Where local law (such as the GDPR in the European Economic Area, the UK
GDPR, or the California Consumer Privacy Act) gives you additional rights,
we will honor them in accordance with that law.

## Cookies and local storage

JACOB uses a small number of cookies and local-storage entries:

- **Authentication session** — Firebase Authentication stores your sign-in
  state in browser storage so you don't have to sign in again on every
  page load.
- **`jacob-has-profile`** — a cookie that tells the app whether you've
  finished onboarding so we can route you to the right page after sign-in.
- **Preferences** — small entries that remember your interface preferences
  (mute lists, notification settings, etc.).

We do not use third-party analytics cookies, advertising cookies, social
sharing widgets, or other tracking technologies.

## Children

JACOB is not intended for children under 13. We do not knowingly collect
personal information from children under 13. If we learn we have collected
information from a child under 13, we will delete it.

Users aged 13–17 may use JACOB only with the consent of a parent or legal
guardian. We document this requirement here as a matter of policy; the
in-app gate that enforces it is part of our launch checklist. If you are a
parent or guardian and believe your child has signed up without your
consent, contact us using the address below and we will remove the
account.

## Security

We use industry-standard measures to protect your data, including
encryption in transit (TLS), encryption at rest, scoped access controls
on our backend, and Firestore security rules that enforce per-group
permissions. No system is perfectly secure; we encourage you to use a
strong, unique password and to enable two-factor authentication on the
account you use to sign in (your email account or Google account).

## Changes to this policy

If we make a material change to how we handle your information, we will
update this page and notify you by email or through an in-app notice
before the change takes effect. We'll keep older versions accessible on
request.

## How to contact us

For privacy questions, requests, or complaints, contact us at
[privacy@jacob.app](mailto:privacy@jacob.app). [Replace with the real
contact address before launch.]
