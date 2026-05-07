import { Link } from "@/components/ui";

/**
 * Compact, public-facing footer that links to the three legal
 * documents. Mounted on the landing page and the auth shell so a
 * visitor can reach the Privacy Policy, Terms, and Community
 * Guidelines before creating an account.
 *
 * Authed pages have their own navigation shells and don't need this
 * footer — the same documents are reachable from the in-app
 * settings menu.
 */
export function LegalFooter() {
  return (
    <footer
      aria-label="Legal"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-caption text-cream-muted"
    >
      <Link href="/privacy" variant="muted" className="text-caption">
        Privacy
      </Link>
      <Link href="/terms" variant="muted" className="text-caption">
        Terms
      </Link>
      <Link href="/guidelines" variant="muted" className="text-caption">
        Community Guidelines
      </Link>
    </footer>
  );
}
