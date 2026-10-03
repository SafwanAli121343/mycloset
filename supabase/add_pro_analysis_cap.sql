-- A Pro subscriber currently has literally unlimited AI usage — nothing stops someone from
-- running analysis in a loop and running up real OpenAI token cost far beyond what $4.99/mo
-- covers. This tracks REAL dollar cost per user (computed from each OpenAI call's actual token
-- usage, not a flat per-action count), reset on a rolling 30-day window from each user's own last
-- reset. Free tier is unaffected — it's already bounded by ai_credits, the one-time-purchase
-- balance, which is a real dollar amount the user already paid for.
--
-- Cents, not a decimal dollar column — avoids floating-point rounding entirely for a running sum
-- that gets added to on every single AI call.
--
-- Run this in Supabase Dashboard -> SQL Editor -> New Query. Safe to run multiple times.

alter table users add column if not exists ai_cost_cents_used integer not null default 0;
alter table users add column if not exists ai_cost_reset_at timestamptz not null default now();
