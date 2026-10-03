-- Purchased-analysis jobs, the shared AI response cache, and stored outfit analyses.
-- Safe to run more than once.

-- ── 1. Analysis jobs ─────────────────────────────────────────────────────────
-- Every "Use score?" / "Perform analysis?" (and Pro's catch-up run right after upgrading) runs as
-- a job on the server, so it keeps going if the app is closed mid-way. A purchased credit is only
-- spent once the finished result has been saved (lib/analysisJobs.ts): a job that fails, or dies
-- silently and goes stale, never costs the user anything.
create table if not exists analysis_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null check (kind in ('item', 'wardrobe', 'pro_backfill')),
  target_id     uuid,                       -- the garment, for kind = 'item'
  paid          boolean not null default true,  -- spends a purchased credit on success
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  heartbeat_at  timestamptz not null default now(),
  finished_at   timestamptz,
  acknowledged  boolean not null default false
);
create index if not exists analysis_jobs_user_status on analysis_jobs (user_id, status);
-- At most one running job of each kind per user — a double tap can't start (or reserve) twice.
create unique index if not exists analysis_jobs_one_running on analysis_jobs (user_id, kind) where status = 'running';
alter table analysis_jobs enable row level security;

-- ── 2. Shared AI response cache ──────────────────────────────────────────────
-- Keyed by a hash of the EXACT request sent to OpenAI (model, every message, settings), with each
-- image replaced by a hash of its actual bytes (lib/aiResponseCache.ts). A stored answer is only
-- reused for a request that is identical in every detail, so a different user adding the same
-- item (same photo, same details, same age band/gender) gets the stored analysis at no AI cost.
create table if not exists ai_response_cache (
  key          text primary key,
  label        text not null,
  model        text not null,
  content      text not null,
  hits         integer not null default 0,
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz
);
alter table ai_response_cache enable row level security;

-- ── 3. Stored outfit analyses ────────────────────────────────────────────────
-- One row per analyzed outfit (combo_key = sorted garment ids). input_hash covers every garment
-- field the analysis reads plus the user's profile, so editing a piece makes the row stale
-- instead of showing an analysis of the old version.
create table if not exists outfit_analyses (
  user_id     uuid not null references users(id) on delete cascade,
  combo_key   text not null,
  input_hash  text not null,
  result      jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, combo_key)
);
alter table outfit_analyses enable row level security;

-- ── 4. Purchased wardrobe reports ────────────────────────────────────────────
-- true once a Full Wardrobe Analysis credit produced (or advanced) this report, so it stays
-- visible on the free tier. A report made only while subscribed is kept but locked after a
-- lapse, and comes straight back on resubscribing.
alter table wardrobe_analysis_state add column if not exists purchased boolean not null default false;

-- ── 5. Hard Pro AI budget ($4.98 per rolling 30 days) ───────────────────────
-- Every OpenAI call goes through lib/aiGateway.ts, which RESERVES a worst-case cost for the call
-- here before sending it (refused if it would take the user past the cap), then settles to the
-- real cost from the response. Reserve + check happen in ONE update statement, so any number of
-- simultaneous requests can't all slip under the cap together — the old check-then-record flow
-- let a burst of parallel calls overshoot it.
-- Fractional cents: a whole-cent column rounded every call's cost.
alter table users alter column ai_cost_cents_used type numeric(12,4) using ai_cost_cents_used::numeric;

create or replace function ai_budget_reserve(p_user uuid, p_cents numeric, p_cap numeric)
returns boolean language plpgsql security definer as $$
declare
  ok boolean;
begin
  update users set
    ai_cost_cents_used = case
      when ai_cost_reset_at is null or ai_cost_reset_at < now() - interval '30 days' then p_cents
      else ai_cost_cents_used + p_cents end,
    ai_cost_reset_at = case
      when ai_cost_reset_at is null or ai_cost_reset_at < now() - interval '30 days' then now()
      else ai_cost_reset_at end
  where id = p_user
    and (
      ((ai_cost_reset_at is null or ai_cost_reset_at < now() - interval '30 days') and p_cents <= p_cap)
      or ai_cost_cents_used + p_cents <= p_cap
    )
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Settles a reservation to the real cost (delta = actual − reserved, usually negative).
create or replace function ai_budget_adjust(p_user uuid, p_delta numeric)
returns void language sql security definer as $$
  update users set ai_cost_cents_used = greatest(0, ai_cost_cents_used + p_delta) where id = p_user;
$$;

revoke all on function ai_budget_reserve(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function ai_budget_adjust(uuid, numeric) from public, anon, authenticated;

-- Atomic credit spend for purchased analyses (lib/analysisJobs.ts): decrements only if ≥ 1.
create or replace function spend_purchase_credit(p_user uuid, p_kind text)
returns boolean language plpgsql security definer as $$
declare
  ok boolean;
begin
  if p_kind = 'item' then
    update users set ai_credits = ai_credits - 1 where id = p_user and ai_credits >= 1 returning true into ok;
  elsif p_kind = 'wardrobe' then
    update users set wardrobe_scan_credits = wardrobe_scan_credits - 1 where id = p_user and wardrobe_scan_credits >= 1 returning true into ok;
  end if;
  return coalesce(ok, false);
end $$;

-- Atomic credit grant (purchases) / removal (refunds). Never goes below 0.
create or replace function add_purchase_credit(p_user uuid, p_kind text, p_n integer)
returns void language plpgsql security definer as $$
begin
  if p_kind = 'item' then
    update users set ai_credits = greatest(0, coalesce(ai_credits, 0) + p_n) where id = p_user;
  elsif p_kind = 'wardrobe' then
    update users set wardrobe_scan_credits = greatest(0, coalesce(wardrobe_scan_credits, 0) + p_n) where id = p_user;
  end if;
end $$;

revoke all on function spend_purchase_credit(uuid, text) from public, anon, authenticated;
revoke all on function add_purchase_credit(uuid, text, integer) from public, anon, authenticated;

-- ── 6. First-run tutorial ────────────────────────────────────────────────────
-- true for a brand-new account until it answers "Tutorial?" (app or website, whichever opens
-- first). Existing accounts default to false, so they're never prompted.
alter table users add column if not exists tutorial_pending boolean not null default false;
