// Slug generator for /j/[slug] share URLs (Task 3 sub-step 9).
//
// 16 base62 characters from crypto.randomBytes with rejection sampling.
// 16 * log2(62) ≈ 95 bits of entropy — brute-force-intractable.
// Rejection sampling avoids modular bias: bytes 0-247 (a multiple of 62)
// map cleanly to a 62-char alphabet; bytes 248-255 are discarded and
// re-drawn. Over 16 chars, the expected re-draw rate is < 6%.
//
// Used by seed.ts (sub-step 3) and the event-share-link RPCs (sub-step 9).

import { randomBytes } from "node:crypto";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALPHABET_LEN = 62;
const SLUG_LEN = 16;

// Largest byte that maps cleanly: 62 * 4 - 1 = 247. Bytes >= 248 would
// introduce bias if mapped via modulo, so we reject and redraw.
const ACCEPT_BELOW = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN;

export function generateShareLinkSlug(): string {
  const out: string[] = [];
  while (out.length < SLUG_LEN) {
    // Draw a generous batch; rejection rate is low so this typically finishes
    // in one round.
    const batch = randomBytes(SLUG_LEN * 2);
    for (let i = 0; i < batch.length && out.length < SLUG_LEN; i++) {
      const b = batch[i] as number;
      if (b < ACCEPT_BELOW) {
        out.push(ALPHABET[b % ALPHABET_LEN] as string);
      }
    }
  }
  return out.join("");
}
