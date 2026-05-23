"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Which menu (if any) is currently open across the entire chat surface.
 *
 * Only one menu can be open at a time. Tapping a different message,
 * tapping outside any menu, or scrolling the message list all close
 * whatever is open. This is the single source of truth — individual
 * `MessageItem`s render their menu off this state rather than holding
 * their own `useState`, so dismissal is reliable and no two menus can
 * ever be visible together.
 */
export type OpenMenuType = "actions" | "reactions" | "more";

export type OpenMenu = {
  mid: string;
  type: OpenMenuType;
};

type Ctx = {
  openMenu: OpenMenu | null;
  open: (mid: string, type: OpenMenuType) => void;
  toggle: (mid: string, type: OpenMenuType) => void;
  close: () => void;
  isOpen: (mid: string, type: OpenMenuType) => boolean;
};

const MessageMenuContext = createContext<Ctx | null>(null);

export function MessageMenuProvider({ children }: { children: ReactNode }) {
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

  const open = useCallback((mid: string, type: OpenMenuType) => {
    setOpenMenu({ mid, type });
  }, []);

  const toggle = useCallback((mid: string, type: OpenMenuType) => {
    setOpenMenu((prev) =>
      prev && prev.mid === mid && prev.type === type ? null : { mid, type },
    );
  }, []);

  const close = useCallback(() => setOpenMenu(null), []);

  const isOpen = useCallback(
    (mid: string, type: OpenMenuType) =>
      openMenu?.mid === mid && openMenu?.type === type,
    [openMenu],
  );

  // Document-level outside-tap dismissal. Anything inside an element
  // tagged `[data-message-menu]` (the action pill, the reaction popover,
  // the more popover) or `[data-keep-menu-open]` (dialogs spawned by
  // those actions) is ignored — everything else closes the menu.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (target instanceof Element) {
        if (target.closest("[data-message-menu]")) return;
        if (target.closest("[data-keep-menu-open]")) return;
      }
      setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [openMenu]);

  // Esc closes whatever is open.
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openMenu]);

  const value = useMemo<Ctx>(
    () => ({ openMenu, open, toggle, close, isOpen }),
    [openMenu, open, toggle, close, isOpen],
  );

  return (
    <MessageMenuContext.Provider value={value}>
      {children}
    </MessageMenuContext.Provider>
  );
}

/**
 * Read the shared menu state. When consumed outside a provider — e.g.
 * a component-level test that renders just `<ReactionPicker>` — fall
 * back to a local-only state so the component still behaves: it opens
 * and closes, just without the cross-message coordination the provider
 * supplies in the real chat surface.
 */
export function useMessageMenu(): Ctx {
  const ctx = useContext(MessageMenuContext);
  const [localOpen, setLocalOpen] = useState<OpenMenu | null>(null);

  // Outside-tap / Esc dismissal for the standalone fallback too — the
  // production provider does this, and tests / docs renders shouldn't
  // get a regressed dismissal contract just because no provider is in
  // the tree.
  useEffect(() => {
    if (ctx) return;
    if (!localOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (target instanceof Element) {
        if (target.closest("[data-message-menu]")) return;
        if (target.closest("[data-keep-menu-open]")) return;
      }
      setLocalOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLocalOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctx, localOpen]);

  if (ctx) return ctx;

  return {
    openMenu: localOpen,
    open: (mid, type) => setLocalOpen({ mid, type }),
    toggle: (mid, type) =>
      setLocalOpen((prev) =>
        prev && prev.mid === mid && prev.type === type ? null : { mid, type },
      ),
    close: () => setLocalOpen(null),
    isOpen: (mid, type) =>
      localOpen?.mid === mid && localOpen?.type === type,
  };
}
