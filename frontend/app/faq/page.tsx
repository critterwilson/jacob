import Link from "next/link";

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
    q: "Is JACOB free?",
    a: "Yes — JACOB is free to use in Phase 1.",
  },
  {
    q: "How do I report inappropriate content?",
    a: "Use the Report link next to any message or on a group page. Reports are reviewed by moderators.",
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back
        </Link>
      </nav>

      <h1 className="mb-6 text-2xl font-semibold">Frequently Asked Questions</h1>

      <dl className="space-y-6">
        {faqs.map(({ q, a }) => (
          <div key={q}>
            <dt className="font-medium text-gray-900">{q}</dt>
            <dd className="mt-1 text-sm text-gray-600">{a}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 text-xs text-gray-400">
        Additional content will be added by Christopher before launch.
      </p>
    </main>
  );
}
