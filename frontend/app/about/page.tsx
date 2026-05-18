import { Heading, Link } from "@/components/ui";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/" variant="muted" className="text-caption">
        ← Back
      </Link>

      <Heading level={1} size="lg">
        About JACOB
      </Heading>

      <div className="space-y-4 text-body-lg leading-relaxed text-cream">
        <p>
          JACOB is a messaging app built for Christian small groups. It
          provides a private, focused space for groups to share messages,
          encouragement, and media with one another.
        </p>
        <p>
          Phase 1 supports small-group chat, group creation, member invites,
          and photo sharing. Future phases will add additional features based
          on community feedback.
        </p>
      </div>
    </main>
  );
}
