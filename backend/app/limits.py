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
