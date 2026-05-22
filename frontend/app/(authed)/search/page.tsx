"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { SearchResultRow } from "@/components/search/SearchResultRow";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useSearch } from "@/lib/hooks/useSearch";

const PER_PAGE = 20;

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const initialQ = params.get("q") ?? "";
  const initialPage = Number(params.get("page") ?? "1") || 1;
  const [q, setQ] = useState(initialQ);
  const [page, setPage] = useState(initialPage);

  const { data, loading, error } = useSearch(q, page, PER_PAGE);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/sign-in");
  }, [user, authLoading, router]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    router.replace(`/search?${next.toString()}`);
  }

  function onPageChange(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    next.set("page", String(nextPage));
    router.replace(`/search?${next.toString()}`);
  }

  if (authLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-cream">Search messages</h1>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          placeholder="Find a message…"
          aria-label="Search query"
          maxLength={200}
          className="flex-1 rounded-md border border-line bg-ink-raised px-3 py-2 text-sm text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {loading && (
        <p className="text-sm text-cream-muted" role="status">
          Searching…
        </p>
      )}
      {error && (
        <p className="text-sm text-terracotta" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && data && data.hits.length === 0 && q.trim() && (
        <p className="text-sm text-cream-muted">No matches found.</p>
      )}

      {data && data.hits.length > 0 && (
        <>
          <p className="text-xs text-cream-muted">
            {data.total} result{data.total === 1 ? "" : "s"}
          </p>
          <ul className="flex flex-col gap-1">
            {data.hits.map((hit) => (
              <li key={hit.messageRef}>
                <SearchResultRow hit={hit} />
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav
              className="flex items-center justify-between pt-2"
              aria-label="Pagination"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                ← Previous
              </Button>
              <span className="text-xs text-cream-muted">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center">
          <span className="text-sm text-cream-muted" role="status">
            Loading…
          </span>
        </main>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
