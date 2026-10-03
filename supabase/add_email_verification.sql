-- Email verification (signup) + forgot-password (code-based reset) + password reuse history.
-- Run this in Supabase Dashboard -> SQL Editor -> New Query. Safe to run multiple times.

alter table users add column if not exists email_verified boolean not null default false;

-- Grandfather in every account that already existed before this migration ran — they never
-- received a signup verification email (the feature didn't exist yet), so without this backfill
-- every existing user would fail the 7-day-grace-period check the moment this ships and get
-- hard-locked out at their very next login, having had no chance to verify anything.
--
-- The cutoff is a hardcoded timestamp, not "where email_verified = false" — that would make this
-- statement unsafe to ever re-run after go-live: it would silently re-verify any real user who
-- signed up afterward but hasn't confirmed their code yet, defeating the feature for them with no
-- warning. Pinned to a fixed point in time, re-running this is a true no-op past the first time.
update users set email_verified = true
  where email_verified = false and created_at < timestamptz '2026-09-26T00:00:00Z';

-- One shared table for both 6-digit-code flows (signup verification, password reset). `code_hash`
-- is a sha256 hash, not bcrypt — brute-forcing a 6-digit code is already bounded by `attempts` +
-- a short expiry + per-IP/per-account rate limiting at the route layer, so a slow hash buys
-- nothing extra here and would just slow down every legitimate check too.
create table if not exists verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('email_verify', 'password_reset')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists verification_codes_user_purpose_idx on verification_codes(user_id, purpose);

-- Stores prior password hashes so a reset/change can reject reuse within the policy window
-- (see lib/auth/passwordHistory.ts). A row is inserted for the hash being REPLACED, not the new
-- one, right before the overwrite.
create table if not exists password_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists password_history_user_idx on password_history(user_id);

alter table verification_codes enable row level security;
drop policy if exists "Service role only" on verification_codes;
create policy "Service role only" on verification_codes for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table password_history enable row level security;
drop policy if exists "Service role only" on password_history;
create policy "Service role only" on password_history for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
