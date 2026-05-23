/**
 * @vitest-environment jsdom
 */
import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FaqPage from "@/app/faq/page";
import { WelcomeTutorial } from "@/components/onboarding/WelcomeTutorial";
import {
  WELCOME_TUTORIAL_STORAGE_KEY,
  useWelcomeTutorial,
} from "@/lib/hooks/useWelcomeTutorial";

// In-memory localStorage substitute so we control persistence per test.
const _store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => {
    _store[k] = v;
  },
  removeItem: (k: string) => {
    delete _store[k];
  },
  clear: () => {
    for (const k of Object.keys(_store)) delete _store[k];
  },
};
vi.stubGlobal("localStorage", mockLocalStorage);

beforeEach(() => {
  mockLocalStorage.clear();
});

describe("useWelcomeTutorial", () => {
  it("auto-opens when localStorage is empty", () => {
    const { result } = renderHook(() => useWelcomeTutorial());
    expect(result.current.open).toBe(true);
  });

  it("does not auto-open when storage key is set", () => {
    localStorage.setItem(WELCOME_TUTORIAL_STORAGE_KEY, "1");
    const { result } = renderHook(() => useWelcomeTutorial());
    expect(result.current.open).toBe(false);
  });

  it("closeTutorial writes the storage key and flips open to false", () => {
    const { result } = renderHook(() => useWelcomeTutorial());
    expect(result.current.open).toBe(true);

    act(() => result.current.closeTutorial());

    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(WELCOME_TUTORIAL_STORAGE_KEY)).toBe("1");
  });

  it("openTutorial re-opens after a previous close", () => {
    const { result } = renderHook(() => useWelcomeTutorial());
    act(() => result.current.closeTutorial());
    expect(result.current.open).toBe(false);
    act(() => result.current.openTutorial());
    expect(result.current.open).toBe(true);
  });
});

describe("WelcomeTutorial overlay", () => {
  it("renders nothing when closed", () => {
    render(<WelcomeTutorial open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a labelled dialog with step progress when open", () => {
    render(<WelcomeTutorial open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(/^Step 1 of 7$/)).toBeInTheDocument();
  });

  it("includes the sticker/tag mechanic slide", async () => {
    render(<WelcomeTutorial open onClose={() => {}} />);
    let safety = 20;
    while (
      safety-- > 0 &&
      !screen.queryByRole("heading", { level: 2, name: /sticker/i })
    ) {
      await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    }
    expect(
      screen.getByRole("heading", { level: 2, name: /sticker/i }),
    ).toBeInTheDocument();
  });

  it("Next walks through the deck and the final Get started button closes", async () => {
    const onClose = vi.fn();
    render(<WelcomeTutorial open onClose={onClose} />);

    // Walk forward until the primary button label changes to Get started.
    let safety = 20;
    while (
      safety-- > 0 &&
      !screen.queryByRole("button", { name: /get started/i })
    ) {
      await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    }
    expect(safety).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Skip button closes the dialog without finishing", async () => {
    const onClose = vi.fn();
    render(<WelcomeTutorial open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Back is disabled on the first slide", () => {
    render(<WelcomeTutorial open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
  });

  it("Back returns to the previous slide after Next", async () => {
    render(<WelcomeTutorial open onClose={() => {}} />);
    const firstHeadingText = screen.getByRole("heading", { level: 2 }).textContent;

    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(
      firstHeadingText,
    );

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      firstHeadingText,
    );
  });
});

describe("FAQ page tutorial launcher", () => {
  it("renders the Show the welcome tour CTA", () => {
    render(<FaqPage />);
    expect(
      screen.getByRole("button", { name: /show the welcome tour/i }),
    ).toBeInTheDocument();
  });

  it("opens the tutorial when the CTA is clicked", async () => {
    render(<FaqPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /show the welcome tour/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closing from the launcher writes the storage key", async () => {
    render(<FaqPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /show the welcome tour/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(localStorage.getItem(WELCOME_TUTORIAL_STORAGE_KEY)).toBe("1");
  });
});
