// One-shot: render three synthetic screenshot fixtures via
// Playwright for the real-API intake smoke.
//
// Committed to test/fixtures/. Re-run only when the intended
// content of a fixture changes; the PNGs live in git so nightly
// runs don't need Playwright.
//
// The fixtures are HTML mock-ups of what a real WhatsApp / email /
// SMS screenshot looks like. THEY ARE NOT REAL SCREENSHOTS. The
// DEVLOG for sub-step 11 calls out this caveat explicitly — real
// accuracy is the shop's usage, not this smoke.

import path from "node:path";
import { mkdir } from "node:fs/promises";

async function main() {
  const outDir = path.resolve(process.cwd(), "test/fixtures");
  await mkdir(outDir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 800 },
    deviceScaleFactor: 2,
  });

  for (const [name, html] of Object.entries(FIXTURES)) {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    const out = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: out, type: "png", fullPage: true });
    await page.close();
    process.stdout.write(`captured ${out}\n`);
  }

  await browser.close();
}

// Q13 refinement: three fixtures covering the three primary
// request_type paths.
const FIXTURES: Record<string, string> = {
  "whatsapp-new-job": whatsappTemplate(
    "Amelia Ross",
    [
      { from: "me", text: "Hi! We just closed on a house in Vienna and want to redo the kitchen counters." },
      { from: "them", text: "Great! What stone are you considering?" },
      { from: "me", text: "Calacatta Gold quartz — approx 42 sqft with a sink cutout and one cooktop cutout. Can you come measure next Monday?" },
      { from: "me", text: "The address is 48 Larchmont Ave, Vienna VA. My number is (555) 411-8823 if easier by phone." },
      { from: "them", text: "Let me check the calendar and get right back to you." },
    ],
  ),
  "email-scheduling-matches-seed": emailTemplate(
    "Sarah Chen <sarah.chen@example.com>",
    "Install confirmation — Friday?",
    "Just circling back on the kitchen island install we discussed. Friday morning still on? The kids will be at school so 9 or 10 AM would both work. — Sarah",
  ),
  "sms-ambiguous": smsTemplate([
    { from: "them", text: "hey" },
    { from: "them", text: "quick q about my counters" },
  ]),
};

// ---- templates ----

function whatsappTemplate(
  contact: string,
  messages: { from: "me" | "them"; text: string }[],
): string {
  const bubbles = messages
    .map((m) => {
      const align = m.from === "me" ? "right" : "left";
      const bg = m.from === "me" ? "#dcf8c6" : "#ffffff";
      return `
        <div style="display:flex;justify-content:${align === "right" ? "flex-end" : "flex-start"};margin:6px 12px;">
          <div style="max-width:70%;background:${bg};border:1px solid #eef;border-radius:12px;padding:8px 12px;font-size:14px;line-height:1.35;">${escapeHtml(m.text)}</div>
        </div>`;
    })
    .join("");
  return baseHtml(
    `
    <div style="background:#128C7E;color:#fff;padding:14px 12px;font:600 15px/1.2 system-ui;">
      <div>${escapeHtml(contact)}</div>
      <div style="font-weight:400;font-size:12px;opacity:.9;">online</div>
    </div>
    <div style="background:#ece5dd;flex:1;padding:8px 0;font-family:system-ui;">
      ${bubbles}
    </div>
    <div style="background:#f7f7f7;padding:10px 12px;font-size:12px;color:#888;">Message…</div>
  `,
  );
}

function emailTemplate(from: string, subject: string, body: string): string {
  return baseHtml(
    `
    <div style="font-family:system-ui;padding:24px;font-size:14px;line-height:1.5;">
      <div style="border-bottom:1px solid #e5e5e5;padding-bottom:14px;margin-bottom:14px;">
        <div style="font-weight:600;font-size:16px;">${escapeHtml(subject)}</div>
        <div style="color:#666;margin-top:6px;">From: ${escapeHtml(from)}</div>
        <div style="color:#666;">To: shop@topmarble.local</div>
      </div>
      <div style="white-space:pre-wrap;">${escapeHtml(body)}</div>
    </div>
  `,
  );
}

function smsTemplate(messages: { from: "me" | "them"; text: string }[]): string {
  const bubbles = messages
    .map((m) => {
      const align = m.from === "me" ? "right" : "left";
      const bg = m.from === "me" ? "#007aff" : "#e5e5ea";
      const color = m.from === "me" ? "#fff" : "#000";
      return `
        <div style="display:flex;justify-content:${align === "right" ? "flex-end" : "flex-start"};margin:4px 12px;">
          <div style="max-width:70%;background:${bg};color:${color};border-radius:18px;padding:8px 14px;font-size:15px;line-height:1.35;">${escapeHtml(m.text)}</div>
        </div>`;
    })
    .join("");
  return baseHtml(
    `
    <div style="background:#f7f7f7;padding:14px 12px;text-align:center;font:600 14px/1.2 system-ui;border-bottom:1px solid #e5e5e5;">
      Unknown
    </div>
    <div style="background:#fff;flex:1;padding:10px 0;font-family:system-ui;">
      ${bubbles}
    </div>
  `,
  );
}

function baseHtml(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;display:flex;flex-direction:column;min-height:100vh;">${inner}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

main().catch((err) => {
  process.stderr.write(
    `intake fixture build failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
