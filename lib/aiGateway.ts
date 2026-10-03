// The ONE way the server talks to OpenAI. Every call goes through here, which gives three
// guarantees in one place instead of at each call site:
//
// 1. WHO MAY PAY. A Pro user's calls draw on their monthly AI budget; a free user's call is only
//    allowed when it's paid for by a purchased credit (`paidByCredit` — lib/analysisJobs.ts);
//    "system" is for admin/maintenance scripts only.
//
// 2. A HARD PRO CAP. Before a request is sent, its WORST-CASE cost (input estimated generously,
//    output = max_tokens, which is always set) is reserved atomically in the database
//    (ai_budget_reserve, supabase/add_analysis_jobs.sql) — refused if it would take the user past
//    PRO_MONTHLY_CAP_CENTS. After the response, the reservation is settled to the real cost.
//    Because the check and the reservation are one SQL statement, parallel requests can never
//    jointly overshoot the cap. If the call fails in a way OpenAI may still have billed (timeout,
//    network drop, 5xx), the reservation is kept rather than refunded.
//
// 3. A SHARED RESPONSE CACHE (ai_response_cache). The cache key is a hash of the exact request —
//    model, every message, every setting — with each image replaced by a hash of its actual
//    bytes. A stored answer is only ever reused for a request identical in every detail, so it is
//    exactly the answer that request would get, at no cost (e.g. a second user adding the same
//    item, or re-opening an outfit whose pieces haven't changed). An image that can't be fetched
//    to hash means no caching for that call — never a guess.
import crypto from "crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { withBreaker } from "@/lib/openaiCircuitBreaker";
import { isSafeUrl } from "@/lib/security/ssrfGuard";
import { estimateCostCents } from "@/lib/billing/aiCost";
import { resolveEntitlement, PRO_MONTHLY_CAP_CENTS, consumeErrorMessage } from "@/lib/billing/entitlements";
import type { User } from "@/lib/db/users";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type AiActor = Pick<User, "id" | "email" | "tier" | "tier_expires_at" | "ai_credits"> | "system";

export class AiNotAllowedError extends Error {
  constructor(public reason: "cap_reached" | "no_credits") {
    super(consumeErrorMessage(reason));
    this.name = "AiNotAllowedError";
  }
}

type ChatParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
export type ChatResult = { content: string; finishReason: string | null; cached: boolean };

export type AiCallOpts = {
  // A free user's call that a purchased credit pays for (the job runner). Ignored for Pro.
  paidByCredit?: boolean;
  // Skip READING the cache (still writes) — for an explicit "analyze again" the user asked for.
  fresh?: boolean;
  // Extra check before a response is stored for reuse (e.g. "has non-empty pros").
  cacheable?: (content: string) => boolean;
  // Breaker timeout for slow calls (default 25s — lib/openaiCircuitBreaker.ts).
  timeoutMs?: number;
};

const DEFAULT_MAX_TOKENS = 4096;
const SAFETY = 1.15;
const IMAGE_TOKENS_HIGH = 1445; // gpt-4o's maximum for one high-detail image (8 tiles × 170 + 85)
const IMAGE_TOKENS_LOW = 85;

// ── Permission + budget ──────────────────────────────────────────────────────

type Reservation = { userId: string; cents: number } | null;

async function reserve(actor: AiActor, cents: number, opts: AiCallOpts): Promise<Reservation> {
  if (actor === "system") return null;
  const ent = resolveEntitlement(actor);
  if (ent.isFullAccessOverride) return null;
  if (ent.tier === "pro") {
    const { data, error } = await sb.rpc("ai_budget_reserve", { p_user: actor.id, p_cents: cents, p_cap: PRO_MONTHLY_CAP_CENTS });
    // Fail CLOSED: if the budget can't be checked (e.g. migration not run), nothing is sent.
    if (error || data !== true) {
      if (error) console.error("[aiGateway] budget reserve failed:", error.message);
      throw new AiNotAllowedError("cap_reached");
    }
    return { userId: actor.id, cents };
  }
  if (opts.paidByCredit) return null; // already paid for with a purchased credit
  throw new AiNotAllowedError("no_credits");
}

async function settle(r: Reservation, actualCents: number): Promise<void> {
  if (!r) return;
  const delta = actualCents - r.cents;
  if (Math.abs(delta) < 0.0001) return;
  const { error } = await sb.rpc("ai_budget_adjust", { p_user: r.userId, p_delta: delta });
  if (error) console.error("[aiGateway] budget settle failed:", error.message);
}

// True only when the request certainly never reached OpenAI's billing (rejected up front), so the
// reservation can be returned. Anything else — timeouts, dropped connections, 5xx — may still
// have been billed, so the worst-case reservation stands.
function certainlyUnbilled(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "EOPENBREAKER") return true; // circuit breaker open: request never sent
  if (e instanceof OpenAI.APIError && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 408) return true;
  return false;
}

// ── Cache key ────────────────────────────────────────────────────────────────

const imageHashMemo = new Map<string, { hash: string; at: number }>();
const MEMO_MS = 10 * 60 * 1000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

async function hashImage(url: string): Promise<string | null> {
  if (url.startsWith("data:")) {
    return crypto.createHash("sha256").update(url.slice(url.indexOf(",") + 1)).digest("hex");
  }
  const memo = imageHashMemo.get(url);
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.hash;
  try {
    // The URL can come from user input — never fetch a private/internal address (SSRF).
    if (!(await isSafeUrl(url))) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    imageHashMemo.set(url, { hash, at: Date.now() });
    if (imageHashMemo.size > 2000) imageHashMemo.delete(imageHashMemo.keys().next().value!);
    return hash;
  } catch {
    return null;
  }
}

// Deep copy of the request with every image URL swapped for its content hash. null = some image
// couldn't be hashed, so this request must not use the cache at all.
async function canonicalize(value: unknown): Promise<unknown | null> {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const c = await canonicalize(v);
      if (c === null && v !== null) return null;
      out.push(c);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "image_url" && obj.image_url && typeof obj.image_url === "object") {
      const iu = obj.image_url as { url: string; detail?: string };
      const h = await hashImage(iu.url);
      if (!h) return null;
      return { type: "image_url", image_url: { sha256: h, detail: iu.detail ?? "auto" } };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const c = await canonicalize(obj[k]);
      if (c === null && obj[k] !== null) return null;
      out[k] = c;
    }
    return out;
  }
  return value;
}

async function cacheKey(kind: string, params: unknown): Promise<string | null> {
  const canon = await canonicalize(params);
  if (canon === null) return null;
  return crypto.createHash("sha256").update(kind + "\n" + JSON.stringify(canon)).digest("hex");
}

async function cacheGet(key: string): Promise<string | null> {
  const { data, error } = await sb.from("ai_response_cache").select("content, hits").eq("key", key).maybeSingle();
  if (error || !data) return null;
  sb.from("ai_response_cache").update({ hits: (data.hits ?? 0) + 1, last_hit_at: new Date().toISOString() })
    .eq("key", key).then(() => {}, () => {});
  return data.content as string;
}

async function cachePut(key: string, label: string, model: string, content: string): Promise<void> {
  await sb.from("ai_response_cache")
    .upsert({ key, label, model, content }, { onConflict: "key", ignoreDuplicates: true })
    .then(() => {}, () => {});
}

// ── Cost estimate ────────────────────────────────────────────────────────────

function estimateInputTokens(messages: ChatParams["messages"]): number {
  let tokens = 0;
  for (const m of messages) {
    tokens += 20;
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") tokens += Math.ceil(c.length / 2);
    else if (Array.isArray(c)) {
      for (const part of c as Array<Record<string, unknown>>) {
        if (part.type === "text") tokens += Math.ceil(String(part.text ?? "").length / 2);
        else if (part.type === "image_url") {
          const detail = (part.image_url as { detail?: string } | undefined)?.detail;
          tokens += detail === "low" ? IMAGE_TOKENS_LOW : IMAGE_TOKENS_HIGH;
        }
      }
    }
  }
  return tokens;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function aiChat(label: string, params: ChatParams, actor: AiActor, opts: AiCallOpts = {}): Promise<ChatResult> {
  // max_tokens is always set, so the reserved output cost is a true upper bound.
  const req: ChatParams = { ...params, max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS };
  const jsonMode = (req.response_format as { type?: string } | undefined)?.type === "json_object";

  // Permission is checked before the cache, so a cache hit never hands a feature to someone who
  // isn't entitled to it — the cache saves money, it doesn't change who can use what.
  if (actor !== "system") {
    const ent = resolveEntitlement(actor);
    if (ent.tier !== "pro" && !ent.isFullAccessOverride && !opts.paidByCredit) throw new AiNotAllowedError("no_credits");
  }

  const key = await cacheKey("chat", req).catch(() => null);
  if (key && !opts.fresh) {
    const hit = await cacheGet(key);
    if (hit != null) return { content: hit, finishReason: "stop", cached: true };
  }

  const reserved = estimateCostCents(req.model, {
    prompt_tokens: estimateInputTokens(req.messages),
    completion_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
  }) * SAFETY;
  const reservation = await reserve(actor, reserved, opts);

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await withBreaker(label, () => openai.chat.completions.create(req), opts.timeoutMs);
  } catch (e) {
    if (certainlyUnbilled(e)) await settle(reservation, 0);
    throw e;
  }
  // No usage reported → keep the worst-case reservation rather than guess low.
  if (completion.usage) await settle(reservation, estimateCostCents(req.model, completion.usage));

  const choice = completion.choices[0];
  const content = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? null;

  if (key && finishReason === "stop" && content.trim()) {
    let ok = true;
    if (jsonMode) {
      try {
        const parsed = JSON.parse(content);
        ok = !!parsed && typeof parsed === "object" && Object.keys(parsed).length > 0;
      } catch { ok = false; }
    }
    if (ok && opts.cacheable) ok = opts.cacheable(content);
    if (ok) await cachePut(key, label, req.model, content);
  }
  return { content, finishReason, cached: false };
}

// The Responses API with web search (brand lookup by domain). Flat reservation: the search fee
// plus a generous token allowance, settled to the real token cost afterwards.
const WEB_SEARCH_FEE_CENTS = 3;
const WEB_SEARCH_RESERVE_CENTS = 12;

export async function aiWebSearch(label: string, input: string, actor: AiActor, opts: AiCallOpts = {}): Promise<string> {
  const params = { model: "gpt-4o", tools: [{ type: "web_search_preview" as const }], input, max_output_tokens: 300 };
  if (actor !== "system") {
    const ent = resolveEntitlement(actor);
    if (ent.tier !== "pro" && !ent.isFullAccessOverride && !opts.paidByCredit) throw new AiNotAllowedError("no_credits");
  }
  const key = await cacheKey("web", params).catch(() => null);
  if (key && !opts.fresh) {
    const hit = await cacheGet(key);
    if (hit != null) return hit;
  }
  const reservation = await reserve(actor, WEB_SEARCH_RESERVE_CENTS, opts);
  let response: OpenAI.Responses.Response;
  try {
    response = await withBreaker(label, () => openai.responses.create(params));
  } catch (e) {
    if (certainlyUnbilled(e)) await settle(reservation, 0);
    throw e;
  }
  if (response.usage) {
    const tokens = estimateCostCents("gpt-4o", { prompt_tokens: response.usage.input_tokens, completion_tokens: response.usage.output_tokens });
    await settle(reservation, tokens + WEB_SEARCH_FEE_CENTS);
  }
  const text = (response.output_text ?? "").trim();
  if (key && text && response.status === "completed") await cachePut(key, label, "gpt-4o", text);
  return text;
}

// Any other paid API with a known flat per-call price (Google Lens via SerpAPI, Cloud Vision):
// same permission + budget + cache rules. `cacheParts` describes the request exactly (images as
// { type: "image_url", image_url: { url } } so they're keyed by content); only a call that
// resolved normally is stored.
export async function aiPaidCall<T>(
  label: string, cacheParts: unknown, flatCents: number, actor: AiActor, fn: () => Promise<T>, opts: AiCallOpts = {},
): Promise<T> {
  if (actor !== "system") {
    const ent = resolveEntitlement(actor);
    if (ent.tier !== "pro" && !ent.isFullAccessOverride && !opts.paidByCredit) throw new AiNotAllowedError("no_credits");
  }
  const key = await cacheKey(`paid:${label}`, cacheParts).catch(() => null);
  if (key && !opts.fresh) {
    const hit = await cacheGet(key);
    if (hit != null) {
      try { return JSON.parse(hit) as T; } catch { /* unreadable entry — fall through to a real call */ }
    }
  }
  await reserve(actor, flatCents, opts); // flat price: the reservation IS the cost
  const result = await fn();
  if (key) {
    const text = JSON.stringify(result);
    if (text !== undefined && (!opts.cacheable || opts.cacheable(text))) await cachePut(key, label, label, text);
  }
  return result;
}

// For routes: turns a refused call into the same friendly error every AI route already returns.
export function aiErrorMessage(e: unknown): string | null {
  return e instanceof AiNotAllowedError ? e.message : null;
}
