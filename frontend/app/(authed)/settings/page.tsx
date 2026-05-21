import { Heading, Link } from "@/components/ui";

const SETTINGS_SECTIONS = [
  { href: "/settings/profile", label: "Edit profile", danger: false },
  { href: "/settings/notifications", label: "Notification settings", danger: false },
  { href: "/settings/blocked", label: "Blocked users", danger: false },
  { href: "/settings/export", label: "Export my data", danger: false },
  { href: "/appeals/new", label: "Submit an appeal", danger: false },
  { href: "/settings/delete-account", label: "Delete account", danger: true },
] as const;

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-5">
      <Heading level={1} size="md">
        Settings
      </Heading>

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
        {SETTINGS_SECTIONS.map(({ href, label, danger }) => (
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
    </div>
  );
}
