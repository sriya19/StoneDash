// Message template renderer.
//
// Substitutes {{placeholder}} tokens in a template body against a context
// object. Pure function — no I/O, no clock, no randomness.
//
// Deliberately does NOT HTML-escape (PLAN.md Q5). Rendered output goes to a
// <textarea> value, the clipboard, and URL-encoded deep links; React escapes
// at render and encodeURIComponent handles the URL. Escaping here would
// corrupt real message text — a customer named "Ben & Jerry's" would reach
// an SMS as "Ben &amp; Jerry&#39;s", and the crew_dispatch template's emoji
// must survive byte-exact.
//
// The injection risk that IS real is template injection: if a context value
// happens to contain "{{shop_phone}}", a multi-pass renderer would expand
// it. Substitution here is single-pass over the source string, so values are
// inserted literally and never re-scanned.

export type TemplateContext = Record<string, string | null | undefined>;

export type RenderResult = {
  text: string;
  /** Placeholders present in the body but absent or empty in the context. */
  missing: string[];
};

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Tidy the punctuation an empty placeholder leaves behind.
 *
 * Without this, a template ending "...call {{shop_phone}}." renders as
 * "...call ." when the org has no phone on file. Handles the shapes the six
 * system templates can actually produce: dangling space-before-punctuation,
 * doubled spaces, empty bracketed/parenthesised fragments, and lines that
 * collapse to a bare label like "Notes:".
 */
function tidy(text: string): string {
  return (
    text
      // "call ." / "on ,"  ->  "call." / "on,"
      .replace(/[ \t]+([.,;:!?])/g, "$1")
      // "()" or "( )" left by an empty value
      .replace(/\(\s*\)/g, "")
      // collapse runs of spaces/tabs, but never newlines — crew_dispatch is
      // a multi-line block and its line structure is meaningful
      .replace(/[ \t]{2,}/g, " ")
      // a line that is now just a label with nothing after it
      .replace(/^[ \t]*[^\S\n]*[\p{Emoji_Presentation}\p{So}]?[ \t]*[A-Za-z ]+:[ \t]*$/gmu, "")
      // trailing whitespace per line
      .replace(/[ \t]+$/gm, "")
      // three or more newlines collapse to two
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Render `body` against `context`.
 *
 * Unknown or empty placeholders render as the empty string and are reported
 * in `missing` so callers can warn in dev. They are never left as a literal
 * "{{token}}" — a half-rendered template reaching a customer is worse than a
 * slightly terse sentence.
 */
export function renderTemplate(
  body: string,
  context: TemplateContext,
): RenderResult {
  const missing: string[] = [];

  // Single pass: String.replace walks the source once and never re-scans
  // what a replacement inserted, so a context value containing "{{...}}"
  // is emitted literally.
  const substituted = body.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = context[key];
    if (value === null || value === undefined || value === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return value;
  });

  return { text: tidy(substituted), missing };
}

/** Every distinct placeholder a template body references, in order. */
export function templatePlaceholders(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    const key = match[1]!.toLowerCase();
    if (!found.includes(key)) found.push(key);
  }
  return found;
}
