# JACOB UI clarity pass — audit + change log

A per-surface clarity-and-simplicity sweep. The criteria for every screen:

1. Is the screen's ONE main purpose obvious within two seconds of landing?
2. Are there too many things competing — could secondary stuff move behind a clear "More" / sub-menu without losing it?
3. Is every button and label in plain language a non-technical ministry member understands?
4. Is anything redundant — the same action or info appearing twice?
5. Are empty states and confirmations clear and reassuring?
6. Does the screen tell the user what to do next?

Touch the copy, the layout, and the placement; **do not** redesign the design system or change what features do.

Status legend: ✅ Shipped · 🟡 Flagged for Christopher · ⏭ Deliberately skipped (no clarity win)

---

## 1. Home (`/home`)

**Purpose:** Land in a familiar place — today's verse + your groups + recent activity.

Mostly clear. Seven sections is a lot but each is a card-sized chunk and the headings scan well.

| Issue | Change |
|---|---|
| `"From your organization"` heading on the ministry-feed strip is fine, but the "See all" link points to `/feed` — the destination is "Organization feed", so the heading should match it. | ✅ Tightened: keep `From your organization` heading, but cross-reference `/feed`'s own header below. |
| Empty groups state shows two stacked CTAs ("Create a group", "Join with code") — clear and balanced. | ⏭ No change. |
| `"Recent in your groups"` heading is good. | ⏭ No change. |
| `"Browse"` block at the bottom (Devotionals / Reading plans / Discover groups) is a great example of a clear sub-menu and stays. | ⏭ No change. |

---

## 2. Groups list (`/groups`)

**Purpose:** Pick which group to open.

Header row crowded on mobile: three buttons compete (Discover groups + Join with code + New group).

| Issue | Change |
|---|---|
| Three primary-weight buttons in the header wrap awkwardly at 390px. | ✅ Drop the "Discover groups" button from the header — Discover is already reachable from the drawer's Grow section and the Home > Browse block. Keep "Join with code" + "New group" only. Reduces the header to two clear actions. |
| Empty state already shows the right two CTAs. | ⏭ No change. |

---

## 3. Group hub (`/groups/[gid]`)

**Purpose:** Open chat, jump to a section, or (for leaders) manage the group.

| Issue | Change |
|---|---|
| Leaders see TWO invite surfaces: the bottom "Invite code" panel (legacy single rotatable code) AND the "Invites" tile inside Manage group (which goes to `/settings/invites`). The bottom panel duplicates a feature already linked above and clutters the page. | ✅ Remove the bottom Invite code panel from the hub. Move the persistent invite code into `/settings/invites` as its own section ("Group's quick-join code") so leaders still have full access to the rotatable code in ONE place. |
| The "All groups" link is fine but small — clarified. | ⏭ No change. |
| `"Manage group"` heading reads correctly. | ⏭ No change. |

---

## 4. Members (`/groups/[gid]/members`)

**Purpose:** See who's in the group; promote / demote / transfer (leader).

| Issue | Change |
|---|---|
| Role badges are lowercase (`leader`, `member`, `founder`, `you`) — inconsistent with the rest of the app's badge casing. | ✅ Capitalize the role badges. |
| Each row exposes the raw `uid` under the name — useless for non-technical leaders and visually noisy. | ✅ Remove the `uid` line from the row body. (The Block / Wellbeing flows operate on the row's identity already.) |
| `WellbeingFlagButton` shows up unlabeled on the right — `aria-label="Flag for wellbeing"` exists in the component, but the bare button has no visible text. | 🟡 Flagged: component-level icon-label tradeoff. Christopher may want a visible "Flag" / "Concern" label — left for follow-up so this PR stays a copy/layout pass. |

---

## 5. Group settings (`/groups/[gid]/settings`)

**Purpose:** Edit name, description, visibility, member cap, archive.

| Issue | Change |
|---|---|
| Member-cap description doesn't say what cap actually means for the leader. | ⏭ Existing copy is acceptable; left for follow-up if Christopher wants. |
| `"Danger zone"` archive action — confirmation already exists in the dialog flow. | ⏭ No change. |

---

## 6. Group invites (`/groups/[gid]/settings/invites`)

**Purpose:** Manage shareable invite links AND the group's quick-join code.

| Issue | Change |
|---|---|
| Today: only manages invite *links* (the new system). The legacy persistent invite *code* lives on the hub. | ✅ Add a "Quick-join code" section at the top with the persistent code + a "Generate new code" button (rotation moves here from the hub). One page for all invite-related leader work. |
| "Invite history" heading is generic. | ✅ Rename to "Invite links" — distinguishes from the quick-join code above. |

---

## 7. Sermons list (`/groups/[gid]/sermons`)

**Purpose:** Browse the group's sermon archive; leader can add one.

| Issue | Change |
|---|---|
| Empty state "No sermons yet." gives no next step. | ✅ Add a leader-aware hint: for leaders, "No sermons yet. Use **Add sermon** above to add the first one." Non-leaders see "No sermons yet — check back soon." |
| Preacher filter has `hideLabel` so the only affordance is the placeholder "All preachers". | ✅ Make the label visible ("Filter by preacher"). |

---

## 8. Sermon detail (`/groups/[gid]/sermons/[sermonId]`)

| Issue | Change |
|---|---|
| `"Watch with the group (not available)"` disabled button is a parked feature. The "(not available)" suffix is awkward. | ✅ Remove the disabled button. Add a small "Watch Together is coming soon." note in its place. |
| `"Open source ↗"` — vague label. | ✅ Rename "Open source" → "Watch / Listen". |

---

## 9. Events list (`/groups/[gid]/events`)

**Purpose:** See upcoming events; leader can add one.

| Issue | Change |
|---|---|
| Recurrence row says `Repeat: [select] Count: [number]` — "Count" is opaque. | ✅ Rename "Count" → "Number of times". |
| Recurrence select options are lowercased ("none / weekly / biweekly"). | ✅ Capitalize: "Don't repeat / Weekly / Every two weeks". |
| RSVP buttons render as `going / maybe / no` plain lowercase, look like text. | ✅ Capitalize them ("Going / Maybe / Can't") and add proper button styling so they read as actions. |
| Empty state "No events scheduled." misses next step. | ✅ Leader-aware: "No events scheduled. Use **New event** to add the first one." Non-leaders: "No events scheduled yet." |

---

## 10. Event detail (`/groups/[gid]/events/[eventId]`)

| Issue | Change |
|---|---|
| `"Roster"` heading — jargon. | ✅ Rename "Roster" → "Who's coming". |
| "Mark attended" checkbox on each row has no visible label on mobile. | ⏭ Component-level — defer to a follow-up if it surfaces in Christopher's feedback. |

---

## 11. Devotionals list (in-group + global)

| Issue | Change |
|---|---|
| In-group empty state references the button with quotation marks ("Use 'Write devotional' to publish one"). | ✅ Rephrase: "No devotionals yet. Leaders can write one using **Write devotional** above." |
| Global page: card eyebrow `"Daily reading"` is loosely tied to actual cadence. | ⏭ Skip — copy is acceptable. |

---

## 12. Join requests (`/groups/[gid]/join-requests`)

| Issue | Change |
|---|---|
| At-cap state only surfaces *after* a failed approve. Leaders deserve advance warning. | ✅ Show a member-cap banner at top when group is at capacity, before any action. |
| Empty state is fine. | ⏭ No change. |

---

## 13. Analytics (`/groups/[gid]/analytics`)

**Purpose:** Leader-only view of group activity.

| Issue | Change |
|---|---|
| Range toggle uses cryptic abbreviations `7d` / `30d`. | ✅ Expand: "Last 7 days" / "Last 30 days". |
| `"Sticker mix"` section heading is jargon. | ✅ Rename "Sticker mix" → "Reactions used". |
| Zero state "Quiet week — see you next Sunday" is on-brand but doesn't say what it means. | ✅ Soften: "No messages yet in this period — once people start chatting, you'll see activity here." |

---

## 14. Watch together (`/groups/[gid]/watch/[sessionId]`)

| Issue | Change |
|---|---|
| Says "Watch Together — not available right now. Check back later." Doesn't tell the user where to go instead. | ✅ Add: "Watch Together is coming soon. In the meantime, visit the **Sermon archive**." with a link to `/groups/[gid]/sermons`. |

---

## 15. Boards list (`/boards`)

| Issue | Change |
|---|---|
| `"Cross-group conversations. Anyone signed in can read and post."` — `"signed in"` is a developer phrasing. | ✅ Rephrase: "Cross-group conversations. Open to everyone in JACOB." |
| Empty-state non-admin copy: `"Check back soon — boards are created by the JACOB team."` — refers to "the JACOB team" which is internal. | ✅ Rephrase: "Check back soon — new boards are added over time." |

---

## 16. Board detail (`/boards/[boardId]`)

| Issue | Change |
|---|---|
| Empty state `"No posts yet. Start the conversation."` is OK. | ⏭ No change. |

---

## 17. Board post (`/boards/[boardId]/[postId]`)

| Issue | Change |
|---|---|
| `"Replies"` heading — generic. | ✅ Rename "Replies" → "Discussion". |

---

## 18. Boards admin list (`/admin/boards`)

| Issue | Change |
|---|---|
| Already revamped in PR #315 — well organized. | ⏭ No change. |

---

## 19. Feed (`/feed`)

| Issue | Change |
|---|---|
| Eyebrow `"Broadcast"` — jargon for non-technical members. | ✅ Replace with "From your organization" (matching the home strip). |

---

## 20. Search (`/search`)

| Issue | Change |
|---|---|
| Placeholder text `"Find a message…"` doesn't say scope. | ✅ Update: "Search messages in your groups…". |
| Pre-search state is blank — no guidance about what's searchable. | ✅ Add an inline hint: "Search across messages from every group you belong to. Try a name, a phrase, or a verse reference." |

---

## 21. Discover (`/discover`)

| Issue | Change |
|---|---|
| Empty state "No groups found." — no next step. | ✅ Rephrase: when filters are active, "No groups match these filters. Try clearing them to see all public groups." When unfiltered: "No public groups yet — check back soon." |
| `"Load more"` button label. | ✅ Rename "Load more" → "Show more groups". |

---

## 22. Discover group detail (`/discover/[gid]`)

| Issue | Change |
|---|---|
| `"Read-only"` label without context. | ✅ Replace with "You're previewing — join to read and post messages." |

---

## 23. Settings index (`/settings`)

**Purpose:** "You" — your profile, account, organization, info.

| Issue | Change |
|---|---|
| "Appeals" section is a single-row list with no context for non-technical users. | ✅ Add a one-line description under the heading: "If something you posted was removed and you think it shouldn't have been, you can ask us to take another look." |
| `"Wellbeing dashboard"` label for moderators — internal jargon. | ⏭ Skip — keep as-is for now; moderator scope is small + the label is established. (Considered "Pastoral concerns" but left for a separate decision.) |

---

## 24. Notifications (`/settings/notifications`)

| Issue | Change |
|---|---|
| `"Organization feed posts"` — vague title. | ✅ Rename to "Posts from your organization". Description stays accurate. |
| Weekly digest title `"Weekly digest email"` reads more like a setting name than a behavior. | ✅ Rename to "Weekly activity summary". |

---

## 25. Blocked users (`/settings/blocked`)

| Issue | Change |
|---|---|
| Each row shows a raw `uid` (e.g. `xK9d2Px...`) as the only identifier. Genuinely useless to leaders/members. | 🟡 Flagged: the right fix is to resolve display names through the API. The page has a CLAUDE.md note acknowledging this — left for the Phase 3 display-name-cache work. **In this PR**, I'm tightening the explanatory copy and improving the empty state so the page is at least clearer about its purpose. |
| Explanatory paragraph is fine. | ⏭ No change. |

---

## 26. Export data (`/settings/export`)

| Issue | Change |
|---|---|
| Status `"Queued — waiting for the next processor run (every 5 minutes)"` exposes job-runner internals. | ✅ Rephrase: "Preparing your data — this can take a few minutes." |

---

## 27. Delete account (`/settings/delete-account`)

**Purpose:** Schedule an irreversible deletion (14-day grace).

| Issue | Change |
|---|---|
| TYPE-DELETE confirmation is a deliberate safety pattern (the action is destructive and the 14-day grace softens the friction). | ⏭ Keep — this is intentional friction. |
| The "Keep my messages" radio's "Recommended" hint is mid-paragraph. | ✅ Move the "Recommended" badge to be visually distinct (small pill next to the heading) so it's seen without reading the description. |

---

## 28. Profile (`/settings/profile`)

| Issue | Change |
|---|---|
| Component-level form layout — fields are reasonably ordered already. | ⏭ No change. |

---

## 29. Organizations list (`/orgs`)

| Issue | Change |
|---|---|
| Clear and clean. | ⏭ No change. |

---

## 30. Org dashboard (`/orgs/[orgId]`)

| Issue | Change |
|---|---|
| Stat tile `"Pending mod"` — abbreviated. | ✅ Rename "Pending mod" → "Awaiting review". |
| `"About this org"` block exposes `Slug` and `Subdomain` (technical fields) inline with the friendly description. | ✅ Hide Slug + Subdomain behind a `<details>` "Show technical details" disclosure. |
| Audience eyebrow displays raw enum value (`"general"`, `"college"`, etc.). | ⏭ Defer — small impact, would need a label map. |

---

## 31. Org sub-pages (admins / groups / analytics / settings)

| Issue | Change |
|---|---|
| Existing pages are clear. | ⏭ No change. |

---

## 32. Admin console — Queue (`/admin/queue`)

| Issue | Change |
|---|---|
| Reason filter dropdown uses internal enums (`harassment`, `sexual`, `violence`, `self-harm`). | ⏭ Skip in this pass — labels are reason codes used elsewhere; rename touches data plumbing. Audit-only. |
| `"Reject + Ban reporter(s)"` bulk action — verb sequencing OK but a clarifying tooltip on what it does would help. | ⏭ Defer. |

---

## 33. Admin — Wellbeing (`/admin/wellbeing`)

| Issue | Change |
|---|---|
| Page header copy already does the explanatory work (existing description). | ⏭ No change. |
| Row labels `"Reporter:"` and `"Concerning:"` — "Reporter" is OK, "Concerning" is awkward. | ✅ Rename "Concerning:" → "About:". |

---

## 34. Admin — Users (`/admin/users`)

| Issue | Change |
|---|---|
| Ban duration buttons: `Ban 24h` / `Ban 7d` / `Ban ∞` — `∞` is cute but ambiguous for some admins. | ✅ Rename "Ban ∞" → "Ban permanently". |

---

## 35. Admin — Appeals (`/admin/appeals`)

| Issue | Change |
|---|---|
| Filter labels `pending` / `upheld` / `reversed` — `upheld` and `reversed` are appeal-specific terms that the page never defines. | ✅ Re-label in the filter as "Pending" / "Upheld (original stands)" / "Reversed (action undone)". |

---

## 36. Admin — Appeal detail (`/admin/appeals/[appealId]`)

| Issue | Change |
|---|---|
| Warning references the error code `self_review_required`. | ✅ Replace with plain language: "If you made the original decision on this content, ask another admin to handle this appeal." |
| `"Reasoning (≥ 50 chars; recorded in audit log)"` — internal phrasing. | ✅ Rename label to "Reasoning" with helper "Required (at least 50 characters). Saved in the audit log." |

---

## 37. Admin — Incidents (`/admin/incidents`)

| Issue | Change |
|---|---|
| SEV codes `SEV1/2/3` — devops jargon. The page already explains them inline; expand the dropdown labels too. | ✅ Dropdown options: "SEV1 — Outage" / "SEV2 — Degraded" / "SEV3 — Informational". |
| `"Display minutes"` numeric input is unintuitive for >60-minute durations. | ⏭ Defer — needs a select rework. |

---

## 38. Admin — NCMEC (`/admin/ncmec`)

| Issue | Change |
|---|---|
| Acronym `NCMEC` is never expanded. | ✅ Expand in the page heading: "NCMEC reports — National Center for Missing & Exploited Children". |

---

## 39. Admin — Feature flags (`/admin/flags`, `/admin/flags/[flagKey]`)

| Issue | Change |
|---|---|
| Engineer-targeted screen; non-engineer admins should not be on these pages routinely. | ⏭ Skip — not in audience for the clarity pass. |

---

## 40. Admin — Applications, Groups, Transparency, NCMEC list

Mostly readable; targeted small fixes captured in #38 above. No structural changes.

---

## 41. Forms across the app (boards' NewPost / NewReply / SermonForm / DevotionalForm / CreateGroupForm)

Spot-checked; copy is clean. Required-field marking is already in place. ⏭ No changes.

---

## Things deliberately NOT touched

- **Chat surface** — revamped in PR #314; structural changes out of scope.
- **Onboarding tutorials** — revamped in PR #317.
- **Bottom tab bar / drawer structure** — revamped in PR #305.
- **Button standard / FloatingActionBar** — established in PRs #306–#311.
- **Design tokens (ink/gold/cream/sage/terracotta)** — this is a clarity pass, not a reskin.

---

## Items flagged for Christopher's call (🟡)

1. **Blocked users still shows raw UIDs** — the right fix is to resolve display names through the API; the existing CLAUDE.md note already tracks this as Phase 3 work. This pass tightens copy only.
2. **WellbeingFlagButton on member rows is icon-only.** Adding a visible "Flag" label would change the row's right-edge density on mobile. Defer until Christopher signals preference.

Everything else: judgment calls were straightforward — labels were swapped to plain language, redundancy was collapsed, sub-menus were added where the screen was overloaded. No screen lost a feature; only how it's presented.

---

## PRs shipped

| PR | Area | Changes |
|---|---|---|
| 1 | Settings + admin | Settings index appeals copy · notifications labels · delete-account "Recommended" pill · export status copy · org dashboard "Awaiting review" + technical details disclosure · admin Wellbeing "About:" · admin Users "Ban permanently" · admin Appeals filter labels · admin Appeal-detail reasoning copy · admin Incidents dropdown · admin NCMEC heading expansion |
| 2 | Group pages | Group hub: remove redundant invite-code panel · group invites page: add quick-join code section · members page: capitalize badges, drop raw uid · sermons list: empty-state hints + visible filter label · sermon detail: drop disabled "Watch with the group" button, rename "Open source" · events list: rename "Count", capitalize options + RSVPs, leader-aware empty state · event detail: "Roster" → "Who's coming" · join-requests: at-cap banner · analytics: range labels, "Sticker mix" rename, soft zero-state copy · watch session: clearer fallback with sermons link |
| 3 | Consumer surfaces | Groups list: drop redundant "Discover groups" header button · boards list: copy and empty-state · board post: "Replies" → "Discussion" · feed: eyebrow rename · search: better placeholder + pre-search hint · discover: empty-state copy + "Show more" button · discover detail: friendlier read-only label · devotionals list empty state |
