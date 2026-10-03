// Real per-call dollar cost, computed from each OpenAI completion's own `usage` field
// (prompt_tokens/completion_tokens), not a flat per-action count. Used by lib/aiGateway.ts both to
// reserve a call's worst-case cost against Pro's monthly cap and to settle it to the real cost.

// Cents per MILLION tokens, as of this session (2026-09) — OpenAI's own pricing page
// (https://openai.com/api/pricing) is the source of truth and these WILL drift over time; re-check
// periodically rather than trusting this table indefinitely. Falls back to gpt-4o's (higher)
// pricing for any model not listed, so an unrecognized model is over-counted rather than free.
const PRICING_CENTS_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 250, output: 1000 },
  "gpt-4o-mini": { input: 15, output: 60 },
};

export type OpenAiUsage = { prompt_tokens?: number; completion_tokens?: number } | null | undefined;

export function estimateCostCents(model: string, usage: OpenAiUsage): number {
  if (!usage) return 0;
  const price = PRICING_CENTS_PER_MILLION[model] ?? PRICING_CENTS_PER_MILLION["gpt-4o"];
  const inputCost  = ((usage.prompt_tokens ?? 0) / 1_000_000) * price.input;
  const outputCost = ((usage.completion_tokens ?? 0) / 1_000_000) * price.output;
  return inputCost + outputCost; // fractional cents — rounded once accumulated below
}
