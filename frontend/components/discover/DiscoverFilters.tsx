"use client";

import { useEffect, useRef, useState } from "react";

const AUDIENCES = [
  { value: "", label: "All" },
  { value: "christian", label: "Christian" },
  { value: "general", label: "General" },
] as const;

type Props = {
  audience: string;
  q: string;
  onAudienceChange: (v: string) => void;
  onQChange: (v: string) => void;
};

export function DiscoverFilters({ audience, q, onAudienceChange, onQChange }: Props) {
  const [inputQ, setInputQ] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    debounceRef.current = setTimeout(() => onQChange(inputQ), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputQ, onQChange]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      <input
        type="search"
        value={inputQ}
        onChange={(e) => setInputQ(e.target.value)}
        placeholder="Search groups…"
        className="rounded border border-line bg-ink-raised px-3 py-1.5 text-sm text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
        aria-label="Search groups"
      />
      <div className="inline-flex rounded border border-line text-sm" role="group" aria-label="Filter by audience">
        {AUDIENCES.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => onAudienceChange(a.value)}
            aria-pressed={audience === a.value}
            className={`px-3 py-1.5 first:rounded-l last:rounded-r focus:outline-none focus-visible:shadow-glow-gold ${
              audience === a.value
                ? "bg-gold text-ink"
                : "bg-ink-raised text-cream-muted hover:bg-ink-overlay"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
