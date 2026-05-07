import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Heading, Link } from "@/components/ui";
import { renderLegalMarkdown } from "@/lib/legal/render";

export type LegalDocumentSlug = "privacy" | "terms" | "guidelines";

type LegalDocumentProps = {
  slug: LegalDocumentSlug;
  title: string;
};

// Resolved at server-render time. Files are committed to the repo
// alongside the rest of the source — readFileSync at module scope
// would be fine, but we resolve per-render so dev edits hot-reload.
function readLegalMarkdown(slug: LegalDocumentSlug): string {
  const path = join(process.cwd(), "content", "legal", `${slug}.md`);
  return readFileSync(path, "utf8");
}

/**
 * Server component shell for the three legal pages. Each page passes
 * its slug + title and the shell handles the markdown read, render,
 * and the consistent visual chrome (back link, draft banner, content
 * column, footer link strip).
 *
 * The descendant selectors on the article wrapper apply
 * design-system tokens (text-cream, font-display, gold accents) to
 * the rendered HTML without needing @tailwindcss/typography.
 */
export function LegalDocument({ slug, title }: LegalDocumentProps) {
  const html = renderLegalMarkdown(readLegalMarkdown(slug));

  return (
    <main
      id="main"
      className="mx-auto max-w-2xl space-y-6 px-4 py-10"
    >
      <Link href="/" variant="muted" className="text-caption">
        ← Back
      </Link>

      <Heading level={1} size="lg">
        {title}
      </Heading>

      {/*
        Draft banner — every legal doc is currently a draft pending
        counsel review. The banner is visible at the top of every
        page (per the C4 spec). Removing this requires the
        engineering owner to confirm with counsel.
      */}
      <div
        role="note"
        aria-label="Draft document"
        className="rounded-md border border-terracotta/50 bg-ink-raised px-4 py-3 text-body-sm text-terracotta"
        data-testid="legal-draft-banner"
      >
        <strong className="font-semibold">DRAFT</strong> — this document
        is a draft and must be reviewed by legal counsel before launch.
        Placeholders such as the effective date, contact email, and
        governing-law jurisdiction must be filled in.
      </div>

      <article
        className={
          // Long-form rhythm: design-system tokens applied via
          // descendant selectors so the rendered markdown picks up
          // the same colors, fonts, and spacing as hand-written pages.
          "max-w-none space-y-4 text-body-lg leading-relaxed text-cream " +
          "[&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-display-md [&_h2]:text-cream " +
          "[&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-display-sm [&_h3]:text-cream " +
          "[&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 " +
          "[&_p]:text-body-lg [&_p]:text-cream [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_ul]:text-cream " +
          "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1 [&_ol]:text-cream " +
          "[&_li]:text-body-lg [&_li]:leading-relaxed " +
          "[&_a]:text-gold [&_a]:underline-offset-4 [&_a]:hover:underline " +
          "[&_strong]:text-cream [&_strong]:font-semibold " +
          "[&_em]:italic " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-gold-soft [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-cream-muted " +
          "[&_hr]:my-8 [&_hr]:border-line"
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer className="border-t border-line pt-4 text-caption text-cream-muted">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacy" variant="muted" className="text-caption">
            Privacy
          </Link>
          <Link href="/terms" variant="muted" className="text-caption">
            Terms
          </Link>
          <Link href="/guidelines" variant="muted" className="text-caption">
            Community Guidelines
          </Link>
        </div>
      </footer>
    </main>
  );
}
