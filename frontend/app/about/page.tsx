import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back
        </Link>
      </nav>

      <h1 className="mb-4 text-2xl font-semibold">About JACOB</h1>

      <div className="prose prose-gray max-w-none text-gray-700 space-y-4 text-sm leading-relaxed">
        <p>
          JACOB is a messaging app built for Christian small groups. It provides a
          private, focused space for groups to share messages, encouragement, and
          media with one another.
        </p>
        <p>
          Phase 1 supports small-group chat, group creation, member invites, and photo
          sharing. Future phases will add additional features based on community
          feedback.
        </p>
        <p className="text-gray-400 text-xs">
          Content will be updated by Christopher before launch.
        </p>
      </div>
    </main>
  );
}
