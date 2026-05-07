"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.tabIndex < 0) return false;
    return true;
  });
}

type UseFocusTrapOptions = {
  active: boolean;
  onEscape?: () => void;
  initialFocus?: "first" | "container";
};

export function useFocusTrap<T extends HTMLElement>({
  active,
  onEscape,
  initialFocus = "first",
}: UseFocusTrapOptions) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = getFocusable(container);
    if (initialFocus === "first" && focusables.length > 0) {
      focusables[0].focus();
    } else {
      // Make container focusable for keyboard users if no children are.
      if (!container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onEscape) {
          e.stopPropagation();
          onEscape();
        }
        return;
      }
      if (e.key !== "Tab") return;

      const current = getFocusable(container);
      if (current.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = current[0];
      const last = current[current.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active, onEscape, initialFocus]);

  return containerRef;
}
