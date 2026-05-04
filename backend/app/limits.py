"""Rate limit strings for each abuse surface.

Used by slowapi @limiter.limit() decorators throughout the routers.
Auth surfaces (sign-in, sign-up, password reset) are handled by Firebase
Authentication natively — see docs/adr/0001-rate-limit-strategy.md.
"""

GROUP_CREATE: str = "5/hour"
GROUP_JOIN: str = "20/hour"
UPLOAD_INIT: str = "10/hour"
INVITE_ROTATE: str = "20/day"
INVITE_CREATE: str = "20/hour"
REPORT_SUBMIT: str = "10/day"
ADMIN_MUTATION: str = "10/minute"
SEARCH_QUERY: str = "30/minute"
ANALYTICS_QUERY: str = "60/hour"
DISCOVER_LIST: str = "60/minute"
BOARDS_LIST: str = "60/minute"
BOARD_ADMIN_MUTATION: str = "10/minute"
# T38 — self-serve data export. One in-flight job per user is enforced
# in the service layer; this limiter additionally caps the *request*
# surface so a retry loop can't fan out into many queued jobs.
EXPORT_REQUEST: str = "1/hour"
ADMIN_LIST: str = "60/minute"

# T58 — feature flags. Admin mutation surface (`/api/admin/flags*`) gets
# its own bucket so a runaway rollout-tweak loop can't starve the wider
# admin-mutation budget. Read surface (`/api/flags`) is per-user and on
# the page-load critical path; SWR revalidates roughly every 60s.
FLAG_MUTATION: str = "30/minute"
FLAG_READ: str = "60/minute"

# T54 — org model. Org create is platform-admin-rate; org-admin
# mutations (attach/detach, admin add/remove, settings) are higher
# but still well below ADMIN_MUTATION because the volume is much
# lower than per-message moderation activity.
ORG_CREATE: str = "5/day"
ORG_ADMIN_MUTATION: str = "30/minute"
ORG_READ: str = "60/minute"

# T55 — DNS verification. Each call hits the public DNS resolver,
# which is fast but not free. Cap per IP to keep the resolver from
# being weaponised against a third party we don't control.
DOMAIN_VERIFY: str = "10/hour"
# `by-host` is unauthenticated middleware traffic; cap on IP to keep
# a runaway middleware loop from melting Firestore.
DOMAIN_BY_HOST: str = "120/minute"

# M2 — users router. Bootstrap is called on every session start so it
# needs a generous limit; profile mutation surfaces are deliberately
# tighter to discourage scripted spam.
USER_BOOTSTRAP: str = "60/minute"
USER_PROFILE_CREATE: str = "5/hour"
USER_PROFILE_UPDATE: str = "30/hour"
USER_NOTIFICATION_PREFS_WRITE: str = "30/hour"
USER_DEVICE_REGISTER: str = "20/hour"
USER_NOTIFICATIONS_LIST: str = "60/minute"
USER_MUTES_LIST: str = "60/minute"
USER_BLOCKS_LIST: str = "60/minute"
USER_MUTES_WRITE: str = "30/minute"
USER_BLOCKS_WRITE: str = "30/minute"

# ── M3 reads ──────────────────────────────────────────────────────────
# All M3 read surfaces. Higher caps than the writes because these are on
# the page-load critical path for chat/groups; pagination + polling
# multiply request count per user.
MY_GROUPS_LIST: str = "30/minute"
GROUP_READ: str = "60/minute"
GROUP_MEMBERSHIP_READ: str = "60/minute"
MEMBERS_LIST: str = "60/minute"
PINNED_MESSAGES_READ: str = "60/minute"
MESSAGES_LIST: str = "60/minute"
MESSAGE_READ: str = "60/minute"
RECENT_MESSAGES_READ: str = "30/minute"
BOARD_POSTS_LIST: str = "60/minute"
BOARD_POST_READ: str = "60/minute"
BOARD_REPLIES_LIST: str = "60/minute"

# ── M4 writes ─────────────────────────────────────────────────────────
GROUP_UPDATE: str = "30/minute"
MESSAGE_CREATE: str = "60/minute"
MESSAGE_EDIT: str = "30/hour"
MESSAGE_DELETE: str = "60/hour"
REACTION_TOGGLE: str = "120/minute"
BOARD_POST_CREATE: str = "30/hour"
BOARD_POST_EDIT: str = "30/hour"
BOARD_POST_DELETE: str = "60/hour"
BOARD_REPLY_CREATE: str = "60/hour"
BOARD_REPLY_EDIT: str = "30/hour"
BOARD_REPLY_DELETE: str = "60/hour"
NOTIFICATION_READ: str = "120/minute"
