export function ArchivedBanner() {
  return (
    <div
      role="status"
      className="border-b border-line bg-ink-raised px-4 py-2 text-center text-body-sm text-parchment-amber"
    >
      This group is archived. New messages are disabled. Unarchive to resume.
    </div>
  );
}
