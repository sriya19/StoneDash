// Phone normalisation for messaging deep links.
//
// TypeScript twin of the `digits_only(text)` SQL function shipped in
// migration 0019 for the customer-collision index. The two must agree:
// scripts/test_message_templates.ts asserts parity against the same inputs
// the SQL function is known to produce, so they cannot silently drift.
//
// SQL:  SELECT COALESCE(regexp_replace(input, '[^0-9]', '', 'g'), '')

/** Strip everything that isn't a digit. Null/undefined collapse to "". */
export function digitsOnly(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[^0-9]/g, "");
}

/**
 * Build a wa.me link. We use https://wa.me rather than the whatsapp://
 * custom scheme (PLAN.md Q7): wa.me resolves to the desktop app when it is
 * installed and to WhatsApp Web otherwise, so the button is never dead,
 * whereas whatsapp:// simply fails when the app is absent.
 *
 * Returns null when there are no digits to route to — callers disable the
 * button rather than rendering a link that goes nowhere.
 *
 * Caveat we cannot detect: wa.me only works if that number actually has
 * WhatsApp. The modal's microcopy says so.
 */
export function whatsAppLink(
  phone: string | null | undefined,
  body: string,
): string | null {
  const digits = digitsOnly(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/**
 * Build an sms: link. RFC 5724 specifies `?body=`; iOS historically wanted
 * `&body=`. There is no single string that satisfies every handler, so we
 * follow the spec — Android and modern iOS both accept it. Task 3.1 Q9 set
 * the precedent of refusing UA detection for exactly this class of problem
 * (PLAN.md Q8).
 */
export function smsLink(
  phone: string | null | undefined,
  body: string,
): string | null {
  const digits = digitsOnly(phone);
  if (!digits) return null;
  return `sms:${digits}?body=${encodeURIComponent(body)}`;
}

/** Build a mailto: link, or null when there is no address on file. */
export function emailLink(
  email: string | null | undefined,
  body: string,
): string | null {
  const trimmed = email?.trim();
  if (!trimmed) return null;
  return `mailto:${encodeURIComponent(trimmed)}?body=${encodeURIComponent(body)}`;
}
