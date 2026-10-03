-- Adds subscription/entitlement state to users, plus tables for redeem keys and purchase
-- records. Run this once against the project's Supabase database (SQL editor or CLI) before
-- deploying the billing endpoints — they assume these columns/tables exist.

alter table users add column if not exists tier             text not null default 'free';
alter table users add column if not exists tier_expires_at  timestamptz;
alter table users add column if not exists tier_source      text; -- 'purchase' | 'key' | 'grant' | null
alter table users add column if not exists ai_credits       integer not null default 0;
alter table users add column if not exists rc_app_user_id   text; -- RevenueCat app_user_id, set at first login

-- ── redeem_keys ──────────────────────────────────────────────────────────────
-- Promo / support-issued codes redeemable in Settings for a temporary tier upgrade or a
-- one-off credit grant. Insert new codes by hand (or a future admin tool) — there is no
-- generation UI yet.
create table if not exists redeem_keys (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  grants_tier   text,               -- e.g. 'pro' — null if this key only grants credits
  grants_days   integer,            -- how many days of grants_tier to add, if grants_tier is set
  grants_credits integer,           -- one-time AI credits to add, if any
  redeemed_by   uuid references users(id),
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists redeem_keys_code_idx on redeem_keys (code) where redeemed_by is null;

-- ── purchases ────────────────────────────────────────────────────────────────
-- Audit trail of every subscription/consumable purchase event we're told about (via the
-- RevenueCat webhook). Never used to grant access directly — users.tier/ai_credits is the
-- single source of truth the app reads; this table exists so a disputed or missing entitlement
-- can be traced back to what RevenueCat actually reported.
create table if not exists purchases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete set null,
  product_id     text not null,
  platform       text,             -- 'ios' | 'android'
  event_type     text not null,    -- RevenueCat event.type, e.g. INITIAL_PURCHASE / RENEWAL / EXPIRATION
  transaction_id text,
  raw_event      jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists purchases_user_idx on purchases (user_id);

-- Full, permanent access for the developer account regardless of tier/expiry — enforced in
-- application code (lib/billing/entitlements.ts) via email match, not by a DB flag, so it can't
-- accidentally be reset by a billing-state sync. This row update is just so users.tier reads
-- sensibly if ever inspected directly.
update users set tier = 'pro', tier_source = 'grant' where email = 'safwan200817@gmail.com';
