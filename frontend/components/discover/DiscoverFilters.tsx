"use client";

import { useEffect, useRef, useState } from "react";

const AUDIENCES = [
  { value: "", label: "All" },
  { value: "christian", label: "Christian" },
  { value: "bjj", label: "BJJ" },
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
        className="rounded border border-gray-200 px-3 py-1.5 text-sm"
        aria-label="Search groups"
      />
      <div className="inline-flex rounded border border-gray-200 text-sm" role="group" aria-label="Filter by audience">
        {AUDIENCES.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => onAudienceChange(a.value)}
            aria-pressed={audience === a.value}
            className={`px-3 py-1.5 first:rounded-l last:rounded-r ${
              audience === a.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
