"use client";

import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";

import type { Member as FullMember } from "@/lib/hooks/useMembers";

// Mention rendering only needs `uid` + `displayName`; accept the
// narrower projection so call-sites can pass partial fixtures (and
// existing `useMembers()` results — which are a strict superset — fit
// trivially).
type Member = Pick<FullMember, "uid" | "displayName">;

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  members: Member[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  "aria-label"?: string;
};

// Walk backwards from cursor. Returns index of the triggering '@' or -1.
function findMentionAt(text: string, cursor: number): number {
  for (let i = cursor - 1; i >= 0; i--) {
    if (text[i] === "@") {
      if (i === 0 || /\s/.test(text[i - 1])) return i;
      return -1;
    }
    if (/\s/.test(text[i])) return -1;
  }
  return -1;
}

export function MentionInput({
  value,
  onChange,
  onBlur,
  members,
  placeholder,
  rows = 2,
  maxLength,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [atPos, setAtPos] = useState(-1);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filtered =
    atPos >= 0
      ? members.filter((m) =>
          m.displayName.toLowerCase().startsWith(query.toLowerCase()),
        )
      : [];

  const open = filtered.length > 0;

  const confirmSelection = (member: Member) => {
    const before = value.slice(0, atPos);
    const after = value.slice(atPos + 1 + query.length);
    const newValue = `${before}@${member.displayName} ${after}`;
    onChange(newValue);
    setAtPos(-1);
    setQuery("");
    setSelectedIdx(0);
    const newCursor = before.length + 1 + member.displayName.length + 1;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(newCursor, newCursor);
        textareaRef.current.focus();
      }
    });
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const cursor = e.target.selectionStart ?? text.length;
    onChange(text);
    const found = findMentionAt(text, cursor);
    if (found >= 0) {
      setAtPos(found);
      setQuery(text.slice(found + 1, cursor));
      setSelectedIdx(0);
    } else {
      setAtPos(-1);
      setQuery("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered[selectedIdx]) {
        e.preventDefault();
        confirmSelection(filtered[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      setAtPos(-1);
      setQuery("");
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={open ? "mention-listbox" : undefined}
        className={className}
      />
      {open && (
        <ul
          id="mention-listbox"
          role="listbox"
          aria-label="mention suggestions"
          className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-52 overflow-y-auto rounded-lg border border-line bg-ink-overlay shadow-pop"
        >
          {filtered.map((member, i) => (
            <li key={member.uid} role="option" aria-selected={i === selectedIdx}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  confirmSelection(member);
                }}
                className={`w-full px-3 py-1.5 text-left text-body-sm transition-colors duration-fast focus:outline-none ${
                  i === selectedIdx
                    ? "bg-ink text-cream"
                    : "text-cream-muted hover:bg-ink hover:text-cream"
                }`}
              >
                {member.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
