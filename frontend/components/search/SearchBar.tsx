"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useSearch } from "@/lib/hooks/useSearch";
import { SearchResultRow } from "@/components/search/SearchResultRow";

/**
 * T28 — global search modal triggered by Cmd-K / Ctrl-K.
 *
 * The component manages its own open/closed state via a window-level
 * keydown listener. The listener is SSR-safe (registered inside
 * `useEffect`) and tears down on unmount.
 */
export function SearchBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error } = useSearch(q);
  useBodyScrollLock(open);

  // Cmd-K / Ctrl-K toggles the modal. Esc closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Mobile entry point — the AppShell header dispatches this event from
  // its search-icon button. Keeping SearchBar's open state internal,
  // signal in via window event so the trigger doesn't need a ref.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("jacob:open-search", onOpen);
    return () => window.removeEventListener("jacob:open-search", onOpen);
  }, []);

  // Focus the input when the modal opens.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  if (!open) return null;

  const goToFullPage = () => {
    setOpen(false);
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search messages"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-safe-t sm:pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="mt-4 w-full max-w-xl rounded-lg bg-ink-raised shadow-pop sm:mt-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToFullPage();
            }}
            placeholder="Search messages…"
            aria-label="Search query"
            className="w-full rounded bg-transparent text-body text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
            maxLength={200}
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && (
            <p className="px-3 py-2 text-xs text-cream-muted" role="status">
              Searching…
            </p>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-terracotta" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && data && data.hits.length === 0 && q.trim() && (
            <p className="px-3 py-2 text-xs text-cream-muted">No matches.</p>
          )}
          {data?.hits.map((hit) => (
            <SearchResultRow
              key={hit.messageRef}
              hit={hit}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </div>

        {data && data.total > data.hits.length && (
          <div className="flex justify-end border-t border-line px-4 py-2">
            <button
              type="button"
              onClick={goToFullPage}
              className="text-xs font-medium text-gold hover:underline"
            >
              View all {data.total} results →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
