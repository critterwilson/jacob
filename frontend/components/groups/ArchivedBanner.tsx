export function ArchivedBanner() {
  return (
    <div
      role="status"
      className="border-b border-yellow-200 bg-yellow-50 px-4 py-2 text-center text-sm text-yellow-800"
    >
      This group is archived. New messages are disabled. Unarchive to resume.
    </div>
  );
}
