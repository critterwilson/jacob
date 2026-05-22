"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  members: Member[];
  placeholder?: string;
  /** Initial rendered rows when empty. Defaults to 1 so the auto-grow starts compact. */
  rows?: number;
  /** Cap on auto-grown rows. Beyond this the textarea scrolls. */
  maxRows?: number;
  maxLength?: number;
  className?: string;
  /**
   * Class applied to the outer wrapper `<div>`. Needed so the wrapper
   * inherits `flex-1` from the parent flex row; without it the textarea
   * is squeezed to its intrinsic content width.
   */
  containerClassName?: string;
  "aria-label"?: string;
};

export type MentionInputHandle = {
  focus: () => void;
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

export const MentionInput = forwardRef<MentionInputHandle, Props>(
  function MentionInput(
    {
      value,
      onChange,
      onBlur,
      onKeyDown,
      members,
      placeholder,
      rows = 1,
      maxRows = 6,
      maxLength,
      className,
      containerClassName,
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const [atPos, setAtPos] = useState(-1);
    const [query, setQuery] = useState("");
    const [selectedIdx, setSelectedIdx] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

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
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (filtered[selectedIdx]) {
            e.preventDefault();
            confirmSelection(filtered[selectedIdx]);
            return;
          }
        }
        if (e.key === "Escape") {
          setAtPos(-1);
          setQuery("");
          return;
        }
      }
      onKeyDown?.(e);
    };

    // Auto-grow: re-measure scrollHeight on every value change and grow
    // the textarea up to `maxRows`. jsdom doesn't implement layout, so
    // we fall back to the prop-driven `rows` value when scrollHeight is
    // zero (tests).
    useLayoutEffect(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      // Capture a single line-height for the cap math. Use lineHeight
      // from computed style; default to 1.5 × font-size.
      const cs = window.getComputedStyle?.(ta);
      const lh = cs ? parseFloat(cs.lineHeight) || 0 : 0;
      if (!lh) return;
      const paddingY =
        (parseFloat(cs?.paddingTop || "0") || 0) +
        (parseFloat(cs?.paddingBottom || "0") || 0);
      const borderY =
        (parseFloat(cs?.borderTopWidth || "0") || 0) +
        (parseFloat(cs?.borderBottomWidth || "0") || 0);
      ta.style.height = "auto";
      const contentH = ta.scrollHeight - paddingY;
      const cappedContentH = Math.min(contentH, lh * maxRows);
      ta.style.height = `${cappedContentH + paddingY + borderY}px`;
      ta.style.overflowY = contentH > lh * maxRows ? "auto" : "hidden";
    }, [value, maxRows]);

    // Reset height when the textarea is rendered empty (after send).
    useEffect(() => {
      if (value === "") {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "";
        ta.style.overflowY = "hidden";
      }
    }, [value]);

    return (
      <div className={containerClassName ?? "relative"}>
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
            className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-ink-overlay shadow-pop"
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
  },
);
