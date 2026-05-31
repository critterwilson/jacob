import type { Metadata } from "next";

import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Eyebrow,
  Heading,
  Input,
  Link,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";

/*
 * Internal design-system showcase. Renders one of every primitive at
 * every variant so we can eyeball the system in context, screenshot
 * representative compositions for review, and catch regressions when
 * tokens or primitives change.
 *
 * Not linked from the app nav. Marked noindex so it doesn't surface
 * in search. Reachable in any environment at /design.
 */

export const metadata: Metadata = {
  title: "Design system — JACOB",
  robots: { index: false, follow: false },
};

function Section({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6 border-t border-line pt-12">
      <div className="space-y-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Heading level={2} size="md">
          {title}
        </Heading>
        {description && (
          <p className="max-w-2xl text-body text-cream-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 w-32 rounded-lg border border-line"
        style={{ backgroundColor: hex }}
      />
      <div className="font-sans text-caption text-cream-muted">
        <div className="text-cream">{name}</div>
        <div className="font-mono">{hex}</div>
      </div>
    </div>
  );
}

export default function DesignSystemShowcase() {
  return (
    <main className="mx-auto max-w-5xl space-y-18 px-6 py-18">
      {/* Hero */}
      <header className="space-y-4">
        <Eyebrow>Internal · /design</Eyebrow>
        <Heading level={1} size="xl">
          The JACOB design system
        </Heading>
        <p className="max-w-2xl text-body-lg text-cream-muted">
          Study-Bible meets restrained Swiss. Reverence, warmth, restraint. The
          tokens and primitives that compose every surface in the app — used
          here as a single visual reference.
        </p>
      </header>

      {/* Color */}
      <Section
        eyebrow="01"
        title="Color"
        description="Dark-first palette. Ink for ground, cream for type, gold used sparingly as the single accent."
      >
        <Tile label="Surfaces">
          <Swatch name="ink" hex="#0E1726" />
          <Swatch name="ink-raised" hex="#15233A" />
          <Swatch name="ink-overlay" hex="#1C2D49" />
        </Tile>
        <Tile label="Lines">
          <Swatch name="line" hex="#243149" />
          <Swatch name="line-strong" hex="#3A4D6E" />
        </Tile>
        <Tile label="Text">
          <Swatch name="cream" hex="#F5EFE0" />
          <Swatch name="cream-muted" hex="#C9C2B3" />
          <Swatch name="cream-muted" hex="#8E8878" />
        </Tile>
        <Tile label="Accent">
          <Swatch name="gold" hex="#C9A95C" />
          <Swatch name="gold-soft" hex="#D9BE7C" />
          <Swatch name="gold-deep" hex="#A8893E" />
        </Tile>
        <Tile label="Semantic">
          <Swatch name="terracotta" hex="#C16B5C" />
          <Swatch name="sage" hex="#7E9B7C" />
          <Swatch name="parchment-amber" hex="#D9B068" />
          <Swatch name="lake" hex="#6E8AA9" />
        </Tile>
      </Section>

      {/* Typography */}
      <Section
        eyebrow="02"
        title="Typography"
        description="EB Garamond for display, Inter for everything else. Reverent pacing — generous line-height on body, tight on display."
      >
        <div className="space-y-6">
          <div>
            <Eyebrow>display-xl · 56 / 1.05 · serif 600</Eyebrow>
            <Heading level={1} size="xl">
              Be still and know
            </Heading>
          </div>
          <div>
            <Eyebrow>display-lg · 40 / 1.10 · serif 600</Eyebrow>
            <Heading level={1} size="lg">
              The vine and the branches
            </Heading>
          </div>
          <div>
            <Eyebrow>display-md · 32 / 1.15 · serif 600</Eyebrow>
            <Heading level={2} size="md">
              Group settings
            </Heading>
          </div>
          <div>
            <Eyebrow>display-sm · 24 / 1.25 · serif 600</Eyebrow>
            <Heading level={3} size="sm">
              Notifications
            </Heading>
          </div>
          <div className="space-y-1">
            <Eyebrow>body-lg · 18 / 1.60 · sans 400</Eyebrow>
            <p className="max-w-2xl text-body-lg text-cream">
              Long-form reading. Devotionals, sermon notes, the About page.
              Generous leading. Comfortable for sitting and reading.
            </p>
          </div>
          <div className="space-y-1">
            <Eyebrow>body · 16 / 1.55 · sans 400</Eyebrow>
            <p className="max-w-2xl text-body text-cream">
              Default body. Form fields, dense paragraph text, message bodies.
              Sits at the optical center of the type scale.
            </p>
          </div>
          <div className="space-y-1">
            <Eyebrow>body-sm · 14 / 1.50 · sans 400</Eyebrow>
            <p className="max-w-2xl text-body-sm text-cream-muted">
              Secondary UI text. Helper copy, metadata, descriptions of fields.
            </p>
          </div>
          <div className="space-y-1">
            <Eyebrow>caption · 12 / 1.40 · sans 500</Eyebrow>
            <p className="max-w-2xl text-caption text-cream-muted">
              Footnote-grade. Timestamps, captions, smallest legible.
            </p>
          </div>
        </div>
      </Section>

      {/* Buttons */}
      <Section
        eyebrow="03"
        title="Buttons"
        description="One gold per surface. Secondary holds the line. Ghost stays out of the way. Destructive earns its terracotta."
      >
        <Tile label="Variants · md">
          <Button variant="primary">Save changes</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="destructive">Delete group</Button>
        </Tile>
        <Tile label="Sizes · primary">
          <Button size="sm">Send</Button>
          <Button size="md">Send message</Button>
          <Button size="lg">Continue</Button>
        </Tile>
        <Tile label="States">
          <Button>Default</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </Tile>
        <Tile label="ButtonLink · navigational CTA">
          <ButtonLink href="/design" variant="primary">
            Open reading plan
          </ButtonLink>
          <ButtonLink href="/design" variant="secondary">
            See all groups
          </ButtonLink>
        </Tile>
      </Section>

      {/* Forms */}
      <Section
        eyebrow="04"
        title="Form fields"
        description="Label above, control, helper or error below. Helper and error never stack — error replaces helper."
      >
        <div className="grid max-w-2xl gap-6 md:grid-cols-2">
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            helperText="We'll only use this for sign-in."
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            error="Must be at least 8 characters."
          />
          <Input label="Display name" defaultValue="Jacob Wilson" />
          <Input label="Disabled field" disabled defaultValue="Read only" />
          <Textarea
            label="About this group"
            placeholder="A short description of who you meet with and what you study together…"
            helperText="Visible to anyone who finds your group on the discover page."
          />
          <Select label="Audience" defaultValue="christian">
            <option value="christian">Christian</option>
            <option value="general">General</option>
          </Select>
        </div>
      </Section>

      {/* Cards */}
      <Section
        eyebrow="05"
        title="Cards"
        description="Surfaces lift off the ink ground with a subtle inner highlight rather than a heavy drop shadow."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Heading level={3} size="sm" className="mb-2">
              Raised
            </Heading>
            <p className="text-body text-cream-muted">
              Default card surface. Use for content blocks and panels that sit
              on the page.
            </p>
          </Card>
          <Card surface="overlay">
            <Heading level={3} size="sm" className="mb-2">
              Overlay
            </Heading>
            <p className="text-body text-cream-muted">
              For modals, popovers, and dropdowns. Lifts further with the deeper
              <code className="ml-1 font-mono text-body-sm">shadow-pop</code>.
            </p>
          </Card>
          <Card interactive>
            <Heading level={3} size="sm" className="mb-2">
              Interactive
            </Heading>
            <p className="text-body text-cream-muted">
              Hover state for entire-card click targets — e.g. a group row in
              the home list.
            </p>
          </Card>
        </div>
      </Section>

      {/* Banners */}
      <Section
        eyebrow="06"
        title="Banners"
        description="Pinned status messages — maintenance, archived, deletion-pending. Color is paired with a left bar so the cue is never color-only."
      >
        <div className="space-y-3 max-w-2xl">
          <Banner tone="info" title="Heads up">
            A new sermon was added to the group&rsquo;s archive.
          </Banner>
          <Banner tone="success" title="Saved">
            Your group settings were updated.
          </Banner>
          <Banner tone="warning" title="Maintenance window">
            JACOB will be undergoing scheduled maintenance on Thursday at 9 PM.
          </Banner>
          <Banner tone="error" title="Couldn&rsquo;t save">
            We weren&rsquo;t able to update the group description. Try again in
            a moment.
          </Banner>
        </div>
      </Section>

      {/* Links */}
      <Section
        eyebrow="07"
        title="Links"
        description="Cream type with a gold hover for the default. Accent for the standout, muted for the back-link."
      >
        <Tile label="Variants">
          <Link href="/design">Default link</Link>
          <Link href="/design" variant="accent">
            Accent link
          </Link>
          <Link href="/design" variant="muted">
            ← Back
          </Link>
        </Tile>
      </Section>

      {/* Skeleton */}
      <Section
        eyebrow="08"
        title="Loading"
        description="One Skeleton primitive replaces the previous mix of 'Loading…' text and animate-pulse blocks."
      >
        <div className="max-w-md space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Section>

      <footer className="border-t border-line pt-8 text-body-sm text-cream-muted">
        Source: <code className="font-mono">docs/design-system.md</code> ·
        Tokens: <code className="font-mono">frontend/styles/tokens.css</code> ·
        Primitives: <code className="font-mono">frontend/components/ui/</code>
      </footer>
    </main>
  );
}
