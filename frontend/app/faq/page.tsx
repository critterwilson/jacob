import { FaqTutorialLauncher } from "@/components/onboarding/FaqTutorialLauncher";
import { Heading, Link } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";

const faqs = [
  {
    q: "How do I create a group?",
    a: 'Sign in, go to Chats, and click "New group". You\'ll get an invite code to share with members.',
  },
  {
    q: "How do I join a group?",
    a: 'Ask a group leader for the invite code, then click "Join with code" on the Chats page.',
  },
  {
    q: `Is ${BRAND_NAME} free?`,
    a: `Yes — ${BRAND_NAME} is free to use in Phase 1.`,
  },
  {
    q: "How do I report inappropriate content?",
    a: "Use the Report link next to any message or on a group page. Reports are reviewed by moderators.",
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/" variant="muted" className="text-caption">
        ← Back
      </Link>

      <Heading level={1} size="lg">
        Frequently Asked Questions
      </Heading>

      <section
        aria-labelledby="faq-tour-heading"
        className="rounded-lg border border-line bg-ink-raised p-4"
      >
        <h2
          id="faq-tour-heading"
          className="font-display text-display-sm text-cream"
        >
          {`New to ${BRAND_NAME}?`}
        </h2>
        <p className="mt-1 text-body-sm text-cream-muted">
          Take a quick walkthrough of how groups, scripture, and the rest of
          the app fit together.
        </p>
        <div className="mt-3">
          <FaqTutorialLauncher />
        </div>
      </section>

      <dl className="space-y-6">
        {faqs.map(({ q, a }) => (
          <div key={q} className="space-y-1">
            <dt className="font-display text-display-sm text-cream">{q}</dt>
            <dd className="text-body-lg leading-relaxed text-cream-muted">
              {a}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
