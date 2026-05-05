import type { Browser, BrowserContext, Page } from "@playwright/test";

/**
 * Public-Mailinator inbox scraper.
 *
 * The free tier has no API and is rate-limited per IP, so we drive the public
 * inbox UI in a fresh browser context (no auth state, no cookies leaking
 * between flows). Anything more invasive than this — opening a private inbox
 * or hitting a JSON API — would require a paid Mailinator plan, which is
 * explicitly out of scope.
 *
 * The inbox URL is `https://www.mailinator.com/v4/public/inboxes.jsp?to=<inbox>`.
 * Messages render in a list; clicking one loads the body inside an iframe with
 * id `html_msg_body`. Verification + reset links live inside that iframe.
 */

const MAILINATOR_BASE = "https://www.mailinator.com";

export type MailinatorOptions = {
  /** How long to wait for the email to appear in the inbox. Default: 60s. */
  timeoutMs?: number;
  /**
   * Substring that must appear in the email subject line (case-insensitive).
   * Useful when the same inbox receives both a verification AND a reset email
   * during a single test.
   */
  subjectIncludes?: string;
};

export type MailinatorMessage = {
  subject: string;
  bodyHtml: string;
  /** Every absolute URL anywhere inside the message (anchor href + raw text). */
  links: string[];
};

/**
 * Open a fresh browsing context to drive Mailinator. The caller must close it.
 * Keeping state isolated from the app under test prevents Mailinator cookies
 * leaking into the JACOB session and vice-versa.
 */
export async function openMailinatorContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

/**
 * Wait until at least one message matching `subjectIncludes` appears in the
 * public inbox, then return its parsed contents. Polls the inbox page on a
 * 3-second cadence — Mailinator pushes messages via a websocket but reload
 * is more robust against silent disconnects in headless Chromium.
 */
export async function fetchLatestEmail(
  page: Page,
  inbox: string,
  opts: MailinatorOptions = {},
): Promise<MailinatorMessage> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const subjectMatch = opts.subjectIncludes?.toLowerCase();
  const inboxURL = `${MAILINATOR_BASE}/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`;
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts += 1;
    await page.goto(inboxURL, { waitUntil: "domcontentloaded" });

    // Mailinator sometimes shows a CAPTCHA / interstitial when scraping
    // is detected. Surface it loudly rather than silently timing out.
    const captcha = await page
      .getByText(/are you human|captcha|cloudflare/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (captcha) {
      throw new Error(
        "Mailinator returned a CAPTCHA / interstitial — public inbox is " +
          "rate-limited or blocked from this IP. Pause and surface to operator.",
      );
    }

    // Wait briefly for the inbox table rows to render. The public inbox
    // uses `tr.ng-scope` rows under `#inboxpane`.
    const rowSelector = "#inboxpane tr";
    await page
      .waitForSelector(rowSelector, { timeout: 5_000 })
      .catch(() => undefined);

    const rows = await page.locator(rowSelector).all();
    for (const row of rows) {
      const subject = (await row.locator("td").nth(2).innerText().catch(() => "")).trim();
      if (!subject) continue;
      if (subjectMatch && !subject.toLowerCase().includes(subjectMatch)) continue;

      await row.click();
      // The message body loads into an iframe.
      const frame = page.frameLocator("iframe#html_msg_body, iframe[name='html_msg_body']");
      // Anchor with an href is the most reliable signal that the iframe content has loaded.
      await frame
        .locator("a[href]")
        .first()
        .waitFor({ state: "attached", timeout: 15_000 })
        .catch(() => undefined);

      const bodyHtml = await frame
        .locator("html")
        .innerHTML()
        .catch(() => "");
      const links = await collectLinks(frame);
      return { subject, bodyHtml, links };
    }

    await page.waitForTimeout(3_000);
  }

  throw new Error(
    `Timed out after ${attempts} polls (${Math.round((Date.now() - start) / 1000)}s) ` +
      `waiting for email in mailinator inbox '${inbox}'` +
      (subjectMatch ? ` matching subject '${subjectMatch}'` : ""),
  );
}

async function collectLinks(
  frame: ReturnType<Page["frameLocator"]>,
): Promise<string[]> {
  const hrefs = await frame
    .locator("a[href]")
    .evaluateAll((els) =>
      (els as HTMLAnchorElement[])
        .map((el) => el.getAttribute("href") ?? "")
        .filter((h) => /^https?:\/\//.test(h)),
    )
    .catch(() => [] as string[]);
  // Some templates embed the URL only in plain text; pull it from the body.
  const bodyText = await frame.locator("body").innerText().catch(() => "");
  const textLinks = Array.from(bodyText.matchAll(/https?:\/\/\S+/g)).map((m) =>
    // Strip trailing punctuation that often follows a URL in plain text.
    m[0].replace(/[.,);\]]+$/, ""),
  );
  return Array.from(new Set([...hrefs, ...textLinks]));
}

/**
 * Pick the verification or reset link out of a message, by host or path
 * heuristic. Firebase email-action links live on the project's
 * `firebaseapp.com` host with a `mode=verifyEmail|resetPassword` query.
 */
export function pickFirebaseActionLink(
  msg: MailinatorMessage,
  mode: "verifyEmail" | "resetPassword",
): string {
  const match = msg.links.find(
    (href) =>
      href.includes("firebaseapp.com") &&
      href.includes(`mode=${mode}`),
  );
  if (match) return match;
  // Fallback: any link that mentions the mode at all.
  const fallback = msg.links.find((href) => href.includes(`mode=${mode}`));
  if (fallback) return fallback;
  throw new Error(
    `No ${mode} link found in mailinator message (links=${JSON.stringify(msg.links)})`,
  );
}
