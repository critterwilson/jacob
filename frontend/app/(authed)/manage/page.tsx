"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

// Phase 1 of the v2 redesign introduces a role-gated "Manage" hub (§5.12)
// — a single destination that collects the queue-shaped duties (approvals,
// moderation, org admin) instead of a separate "/admin" section that feels
// like a different app (principle 1.5). This Phase-1 version is a thin hub
// of link cards that route to surfaces that ALREADY exist; the full hub —
// at-a-glance count card, the minor-specific owner approvals surface, the
// moderation Review queue, Appeals (§5.10/§5.11/§5.13) — is Phase 3.
//
// Visibility: the tab and this page are gated to anyone with a management
// duty — platform claims (admin / moderator / ministry owner) OR a per-
// group leader/owner role on any group. A plain member who reaches the URL
// directly is redirected to /groups.

type DutyCard = {
  href: string;
  label: string;
  description: string;
};

function Card({ card }: { card: DutyCard }) {
  return (
    <Link
      href={card.href}
      className="block rounded-lg border border-line bg-ink-raised p-4 no-underline transition-colors hover:border-line-strong hover:bg-ink-raised/80"
    >
      <Heading level={2} size="sm" className="mb-1 normal-case">
        {card.label}
      </Heading>
      <p className="text-body-sm text-cream-muted">{card.description}</p>
    </Link>
  );
}

export default function ManagePage() {
  const router = useRouter();
  const { user } = useAuth();
  const roles = useRoleClaims();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);

  const isAdmin = roles?.isAdmin === true;
  const isModerator = roles?.isModerator === true;
  const isOwner = roles?.isMinistryOwner === true;
  const ledGroups = groups.filter((g) => g.role === "leader");
  const isLeader = ledGroups.length > 0;
  const isPrivileged = isAdmin || isModerator || isOwner || isLeader;

  // Redirect plain members away once roles + memberships have resolved.
  // `roles === null` means the token hasn't loaded yet; wait for it (and
  // for the groups request) before deciding, so we don't bounce a leader
  // mid-load.
  const resolved = roles !== null && !groupsLoading;
  useEffect(() => {
    if (resolved && !isPrivileged) {
      router.replace("/groups");
    }
  }, [resolved, isPrivileged, router]);

  if (!resolved || !isPrivileged) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  // Approvals — every privileged role has something to approve. Leaders
  // approve adult join requests for their group(s); owners/admins finalize
  // minors and work the platform queue. The two-step minor flow (a leader
  // vouches, the owner finalizes — PR #360) stays reachable through these
  // existing surfaces; this hub only routes to them, it doesn't change the
  // flow.
  const approvals: DutyCard[] = [];
  if (isLeader) {
    for (const g of ledGroups) {
      approvals.push({
        href: `/groups/${g.id}/join-requests`,
        label: `Approvals · ${g.name}`,
        description: "Review people waiting to join this group.",
      });
    }
  }
  if (isOwner || isAdmin) {
    approvals.push({
      href: "/admin/minor-reviews",
      label: "Minor approvals",
      description: "Finalize under-18 join requests. Only you can approve these.",
    });
  }

  // Moderation — admins/moderators route to the existing consoles.
  const moderation: DutyCard[] = [];
  if (isAdmin) {
    moderation.push({
      href: "/admin/queue",
      label: "Moderation queue",
      description: "Triage flagged and reported content.",
    });
  }
  if (isAdmin || isModerator) {
    moderation.push({
      href: "/admin/wellbeing",
      label: "Wellbeing",
      description: "Review wellbeing flags raised by group leaders.",
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <Eyebrow>Your duties</Eyebrow>
        <Heading level={1} size="lg" className="normal-case">
          Manage
        </Heading>
      </div>

      {approvals.length > 0 && (
        <section className="space-y-3" aria-labelledby="manage-approvals">
          <Heading
            level={2}
            size="sm"
            id="manage-approvals"
            className="normal-case text-cream-muted"
          >
            Approvals
          </Heading>
          {approvals.map((c) => (
            <Card key={c.href} card={c} />
          ))}
        </section>
      )}

      {moderation.length > 0 && (
        <section className="space-y-3" aria-labelledby="manage-moderation">
          <Heading
            level={2}
            size="sm"
            id="manage-moderation"
            className="normal-case text-cream-muted"
          >
            Moderation
          </Heading>
          {moderation.map((c) => (
            <Card key={c.href} card={c} />
          ))}
        </section>
      )}

      <p className="text-body-sm text-cream-muted/70">
        More management tools are on the way.
      </p>
    </div>
  );
}
