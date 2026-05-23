"use client";

import { Heading, Link } from "@/components/ui";
import { useMyOrgs } from "@/lib/hooks/useMyOrgs";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

type Item = { href: string; label: string; danger?: boolean };

// Account sub-pages — what was the entire /settings list before.
// "Edit profile" stays the first entry (the e2e settings spec asserts
// it's visible directly after navigating to /settings).
const ACCOUNT_ITEMS: Item[] = [
  { href: "/settings/profile", label: "Edit profile" },
  { href: "/settings/notifications", label: "Notification settings" },
  { href: "/settings/blocked", label: "Blocked users" },
  { href: "/settings/export", label: "Export my data" },
  { href: "/settings/delete-account", label: "Delete account", danger: true },
];

const APPEALS_ITEMS: Item[] = [
  { href: "/appeals/new", label: "Submit an appeal" },
];

const INFO_ITEMS: Item[] = [
  { href: "/about", label: "About JACOB" },
  { href: "/faq", label: "FAQ" },
  { href: "/guidelines", label: "Community guidelines" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

export default function YouPage() {
  const roles = useRoleClaims();
  const { orgs } = useMyOrgs();

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-6">
      <Heading level={1} size="md">
        You
      </Heading>

      <Section title="Account" items={ACCOUNT_ITEMS} />

      <Section
        title="Appeals"
        description="If something you posted was removed and you think it shouldn't have been, you can ask us to take another look."
        items={APPEALS_ITEMS}
      />

      {orgs.length > 0 && (
        <section className="space-y-2" aria-labelledby="you-orgs-heading">
          <h2
            id="you-orgs-heading"
            className="px-1 text-eyebrow uppercase tracking-wider text-cream-muted"
          >
            Organizations
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
            {orgs.map((org) => (
              <li key={org.orgId}>
                <Link
                  href={`/orgs/${org.orgId}`}
                  variant="muted"
                  className="block px-4 py-3 text-body text-cream no-underline transition-colors duration-fast hover:bg-ink-overlay"
                >
                  {org.name}
                  {org.role === "admin" && (
                    <span className="ml-2 text-caption text-cream-muted">
                      (admin)
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {roles?.isAdmin && (
        <Section
          title="Admin"
          items={[{ href: "/admin/queue", label: "Admin console" }]}
        />
      )}

      {roles?.isModerator && !roles.isAdmin && (
        <Section
          title="Moderation"
          items={[{ href: "/admin/wellbeing", label: "Wellbeing dashboard" }]}
        />
      )}

      <Section title="Info" items={INFO_ITEMS} />
    </div>
  );
}

function Section({
  title,
  items,
  description,
}: {
  title: string;
  items: Item[];
  description?: string;
}) {
  const headingId = `you-${title.toLowerCase().replace(/\s+/g, "-")}-heading`;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="px-1 text-eyebrow uppercase tracking-wider text-cream-muted"
      >
        {title}
      </h2>
      {description && (
        <p className="px-1 text-caption text-cream-muted">{description}</p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
        {items.map(({ href, label, danger }) => (
          <li key={href}>
            <Link
              href={href}
              variant="muted"
              className={`block px-4 py-3 text-body no-underline hover:bg-ink-overlay transition-colors duration-fast ${danger ? "text-terracotta" : "text-cream"}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
