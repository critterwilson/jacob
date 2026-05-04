/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageBody } from "@/components/chat/MessageBody";
import { renderMarkdownToHtml } from "@/lib/markdown";

describe("renderMarkdownToHtml (T53)", () => {
  it("renders bold + italic", () => {
    const html = renderMarkdownToHtml("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    const html = renderMarkdownToHtml("Use `git status` to check.");
    expect(html).toContain("<code>git status</code>");
  });

  it("renders blockquotes and lists", () => {
    const html = renderMarkdownToHtml(
      "> Quote\n\n- Item 1\n- Item 2",
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
  });

  it("strips raw HTML / script tags", () => {
    const html = renderMarkdownToHtml(
      "<script>alert('xss')</script> normal text",
    );
    expect(html).not.toContain("<script>");
    expect(html.toLowerCase()).not.toContain("alert");
  });

  it("strips images even with markdown syntax", () => {
    const html = renderMarkdownToHtml("![alt](https://evil/img.gif)");
    expect(html).not.toContain("<img");
  });

  it("renders headings as plain paragraphs", () => {
    const html = renderMarkdownToHtml("# Big title");
    expect(html).not.toContain("<h1>");
    expect(html).toContain("Big title");
  });

  it("disallows javascript: links", () => {
    const html = renderMarkdownToHtml("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("autolinks https URLs with rel=noopener noreferrer + target=_blank", () => {
    const html = renderMarkdownToHtml("Visit https://example.com today");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("strips raw HTML attributes too (defense in depth via DOMPurify)", () => {
    const html = renderMarkdownToHtml(
      "<a href=\"https://x.test\" onclick=\"hack()\">click</a>",
    );
    expect(html).not.toContain("onclick");
  });
});

describe("<MessageBody />", () => {
  it("renders body inside a sanitized div", () => {
    const { container } = render(<MessageBody body="**hello**" />);
    expect(container.querySelector("strong")?.textContent).toBe("hello");
  });

  it("renders unfurl cards when supplied (max 3)", () => {
    const { container } = render(
      <MessageBody
        body="link"
        unfurls={[
          {
            url: "https://a.test",
            title: "A",
            description: null,
            imageUrl: null,
            siteName: null,
          },
          {
            url: "https://b.test",
            title: "B",
            description: null,
            imageUrl: null,
            siteName: null,
          },
          {
            url: "https://c.test",
            title: "C",
            description: null,
            imageUrl: null,
            siteName: null,
          },
          {
            url: "https://d.test",
            title: "D",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ]}
      />,
    );
    const cards = container.querySelectorAll('a[target="_blank"]');
    // 3 unfurl cards (the 4th is dropped by the cap).
    expect(cards.length).toBe(3);
  });

  it("dedupes unfurl URLs across persisted + client lists", () => {
    const { container } = render(
      <MessageBody
        body="link"
        unfurls={[
          {
            url: "https://a.test",
            title: "Persisted A",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ]}
        clientUnfurls={[
          {
            url: "https://a.test",
            title: "Client A",
            description: null,
            imageUrl: null,
            siteName: null,
          },
          {
            url: "https://b.test",
            title: "Client B",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("Persisted A");
    expect(container.textContent).not.toContain("Client A"); // dedupe wins
    expect(container.textContent).toContain("Client B");
  });
});
