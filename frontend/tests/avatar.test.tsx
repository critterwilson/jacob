/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui";

describe("Avatar", () => {
  describe("photoURL safety (CodeQL js/xss-through-dom)", () => {
    it("renders an https URL into <img src>", () => {
      const { container } = render(
        <Avatar
          name="Jacob"
          photoURL="https://example.com/photo.jpg"
        />,
      );
      const img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
    });

    it("renders a blob: preview URL into <img src>", () => {
      const { container } = render(
        <Avatar
          name="Jacob"
          photoURL="blob:https://example.com/abc-123"
        />,
      );
      const img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "blob:https://example.com/abc-123");
    });

    it("drops a javascript: URI to the initials fallback", () => {
      const { container } = render(
        <Avatar name="Mallory" photoURL="javascript:alert(1)" />,
      );
      expect(container.querySelector("img")).toBeNull();
      // initials fallback is rendered instead
      expect(screen.getByText("M")).toBeInTheDocument();
    });

    it("drops a data:text/html payload to the initials fallback", () => {
      const { container } = render(
        <Avatar
          name="Mallory"
          photoURL="data:text/html,<script>alert(1)</script>"
        />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText("M")).toBeInTheDocument();
    });

    it("treats null/undefined/empty as no photo", () => {
      const { container, rerender } = render(
        <Avatar name="Jacob" photoURL={null} />,
      );
      expect(container.querySelector("img")).toBeNull();
      rerender(<Avatar name="Jacob" photoURL="" />);
      expect(container.querySelector("img")).toBeNull();
      rerender(<Avatar name="Jacob" photoURL={undefined} />);
      expect(container.querySelector("img")).toBeNull();
    });
  });

  describe("name escaping", () => {
    it("escapes HTML metacharacters in name when rendering initials", () => {
      // React escapes JSX text by default; this is a regression guard.
      const malicious = "<script>alert(1)</script>";
      const { container } = render(<Avatar name={malicious} />);
      // No <script> element should be created from the name.
      expect(container.querySelector("script")).toBeNull();
      // The first character of the escaped name is "<" → uppercased to "<".
      expect(screen.getByText("<")).toBeInTheDocument();
    });

    it("uses '?' for empty/whitespace names", () => {
      const { rerender } = render(<Avatar name="" />);
      expect(screen.getByText("?")).toBeInTheDocument();
      rerender(<Avatar name="   " />);
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });
});
