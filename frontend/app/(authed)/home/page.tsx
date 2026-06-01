"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// `/home` was removed as a destination in the v2 redesign (§7.2): there is
// no synthetic dashboard anymore — members land in their groups (the
// gravity well). This route survives only as a redirect so existing deep
// links, bookmarks, and push payloads pointing at /home don't 404. The
// content that used to live here moved: the weekly sermon, install prompt,
// and push prompt now sit at the top of the Groups list (see
// app/(authed)/groups/page.tsx).
export default function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/groups");
  }, [router]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-ink">
      <span className="text-body-sm text-cream-muted" role="status">
        Loading…
      </span>
    </main>
  );
}
