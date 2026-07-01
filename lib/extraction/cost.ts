// Token-based cost math for the two OpenAI models used by the
// extraction pipeline. Prices are as-of-2026-06. If OpenAI moves them
// again, update these constants; we hard-code intentionally so a
// pricing change surfaces in a code review rather than silently
// drifting our telemetry.

// USD per 1k tokens.
const PRICING = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
} as const;

export type PricedModel = keyof typeof PRICING;

export function isPricedModel(name: string): name is PricedModel {
  return name === "gpt-4o-mini" || name === "gpt-4o";
}

// Returns cost in cents (rounded up to the nearest cent, so a
// 0.3-cent call still shows up as 1 cent — better to over-report
// than silently drop sub-cent calls that add up across a month).
export function costCents(
  model: PricedModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = PRICING[model];
  const dollars =
    (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
  return Math.max(0, Math.ceil(dollars * 100));
}
