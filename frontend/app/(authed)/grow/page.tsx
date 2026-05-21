import { Heading, Link } from "@/components/ui";

// Grow is the spiritual-content section landing — the same four
// destinations that live in the drawer's GROW group, rendered as a real
// page so the bottom-tab "Grow" lands somewhere coherent rather than
// redirecting into one sub-feature. The cards mirror Home's Browse
// section visually (same one-line subtitle pattern) so the two surfaces
// feel like sibling discovery surfaces.
const SECTIONS: { href: string; label: string; description: string }[] = [
  {
    href: "/devotionals",
    label: "Devotionals",
    description: "Short scripture reflections",
  },
  {
    href: "/reading-plans",
    label: "Reading plans",
    description: "Multi-day scripture journeys",
  },
  {
    href: "/discover",
    label: "Discover groups",
    description: "Find a public small group",
  },
  {
    href: "/search",
    label: "Search",
    description: "Find a message across your groups",
  },
];

export default function GrowPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <Heading level={1} size="md">
        Grow
      </Heading>
      <p className="text-body-sm text-cream-muted">
        Devotionals, reading plans, and other ways to keep growing between
        your group conversations.
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SECTIONS.map(({ href, label, description }) => (
          <li key={href}>
            <Link
              href={href}
              variant="muted"
              className="block rounded-lg border border-line bg-ink-raised px-4 py-3 no-underline transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:shadow-glow-gold"
            >
              <span className="block text-body text-cream">{label}</span>
              <span className="block text-caption text-cream-muted">
                {description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
