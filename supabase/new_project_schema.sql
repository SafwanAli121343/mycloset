-- ============================================================================
-- Fresh Supabase project schema for mycloset.
-- Reconstructed from application code + the incremental migration files in
-- this directory (the old project has no single checked-in schema.sql, only
-- ALTER-style patches layered on a dashboard-created base) — see the
-- 2026-09-02 schema-reconstruction pass for full provenance/confidence notes
-- per table. Run this ONCE, in order, against a brand-new empty project via
-- the Supabase SQL Editor.
--
-- A few columns' exact types were ambiguous in the old (unreachable) project
-- and have been resolved here with the most sensible default for a fresh
-- start rather than guessed to match unknown legacy data exactly:
--   - refresh_tokens.user_id -> uuid (a stale code comment said text; users.id
--     is uuid everywhere else, confirmed by wardrobe_analysis_state's FK)
--   - outfits.date -> date (always compared with gte/lte range semantics)
--   - outfits.ai_garment_ids -> uuid[] (holds garment id strings)
--   - ON DELETE CASCADE added consistently on every user-owned table's
--     user_id FK (only confirmed on wardrobe_analysis_state in the old
--     project; the app manually cascades deletes in code regardless, so this
--     is a safety net, not a behavior change it depends on)
--   - garments.measurements (present in a TS type, but no live read/write
--     path found anywhere) is intentionally OMITTED as dead weight — add it
--     back with `ALTER TABLE garments ADD COLUMN measurements jsonb;` if some
--     code path turns out to need it after all.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── users ────────────────────────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- ── refresh_tokens ───────────────────────────────────────────────────────
create table refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on refresh_tokens(user_id);

-- ── garments ─────────────────────────────────────────────────────────────
create table garments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  title            text not null,
  price            text,
  source           text not null,
  link             text not null,
  image            text,
  category         text not null,
  brand            text,
  sub_type         text,
  color_primary    text,
  color_secondary  text,
  fit              text,
  pattern          text,
  design_complexity numeric,
  logo_prominence  numeric,
  material         text,
  aesthetic_tags   text[],
  formality        text,
  pros             text[],
  cons             text[],
  color_pairings   text[],
  color_clashes    text[],
  style_pairings   text[],
  tags             jsonb,
  confidence       jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index idx_garments_user_id on garments(user_id);
create index idx_garments_tags on garments using gin(tags);
create index idx_garments_tags_sw_cat on garments using gin((tags->'streetwear_category'));
create index idx_garments_tags_features on garments using gin((tags->'features'));
create index idx_garments_tags_aesthetic on garments using gin((tags->'aesthetic'));

-- ── outfits ──────────────────────────────────────────────────────────────
create table outfits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  date           date not null,
  notes          text,
  ai_garment_ids uuid[],
  created_at     timestamptz not null default now()
);
create index idx_outfits_user_id on outfits(user_id);
create index idx_outfits_date on outfits(date);

-- ── outfit_items ─────────────────────────────────────────────────────────
create table outfit_items (
  id         uuid primary key default gen_random_uuid(),
  outfit_id  uuid not null references outfits(id) on delete cascade,
  garment_id uuid not null references garments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index idx_outfit_items_outfit_id on outfit_items(outfit_id);
create index idx_outfit_items_garment_id on outfit_items(garment_id);

-- ── wardrobe_analysis_state ──────────────────────────────────────────────
create table wardrobe_analysis_state (
  user_id          uuid primary key references users(id) on delete cascade,
  analysis_history jsonb not null default '[]'::jsonb,
  crossed          jsonb not null default '[]'::jsonb,
  current_level    integer not null default 1,
  updated_at       timestamptz default now(),
  highest_score    integer
);

-- ── streetwear_products (public catalog, not per-user) ──────────────────
create table streetwear_products (
  id              uuid primary key default gen_random_uuid(),
  brand           text not null,
  title           text not null,
  price           numeric,
  price_text      text,
  image_url       text,
  product_url     text not null,
  category        text,
  sub_type        text,
  color_primary   text,
  color_secondary text,
  aesthetic_tags  text[],
  gender          text default 'unisex',
  brand_tier      text,
  source_domain   text,
  in_stock        boolean default true,
  analyzed        boolean default false,
  scraped_at      timestamptz default now(),
  last_checked_at timestamptz,
  check_failures  integer default 0,
  source_links    jsonb default '[]',
  fit             text,
  pattern         text,
  material        text,
  formality       text,
  tags            jsonb,
  pros            text[],
  cons            text[],
  color_pairings  text[],
  color_clashes   text[],
  constraint sw_products_url_uq unique (product_url)
);
create index idx_sw_fts on streetwear_products using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(brand,'')));
create index idx_sw_cat on streetwear_products(category);
create index idx_sw_gender on streetwear_products(gender);
create index idx_sw_brand on streetwear_products(brand);
create index idx_sw_tier on streetwear_products(brand_tier);
create index idx_sw_last_checked on streetwear_products(last_checked_at nulls first);
create index idx_sw_brand_title on streetwear_products(brand, lower(title));
create index idx_sw_products_tags on streetwear_products using gin(tags);
create index idx_sw_products_aesthetic on streetwear_products using gin(aesthetic_tags);

-- ── discovered_brands ────────────────────────────────────────────────────
create table discovered_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- ── audit_log ────────────────────────────────────────────────────────────
-- user_id is deliberately a loose text field, not an FK — failed-login
-- audit entries need to log an attempted identifier even when no real user
-- was ever resolved.
create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    text,
  action     text not null,
  ip         text,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_log_user_id on audit_log(user_id);
create index idx_audit_log_created_at on audit_log(created_at);

-- ============================================================================
-- Row-level security — every table is written/read exclusively through the
-- server-side service-role client; no table is ever queried with the anon
-- key except streetwear_products (a public catalog, intentionally readable).
-- ============================================================================
alter table users                   enable row level security;
alter table refresh_tokens          enable row level security;
alter table garments                enable row level security;
alter table outfits                 enable row level security;
alter table outfit_items            enable row level security;
alter table wardrobe_analysis_state enable row level security;
alter table streetwear_products     enable row level security;
alter table discovered_brands       enable row level security;
alter table audit_log               enable row level security;

create policy "Service role only" on users
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on refresh_tokens
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on garments
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on outfits
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on outfit_items
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role manages wardrobe analysis state" on wardrobe_analysis_state
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on discovered_brands
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "Service role only" on audit_log
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- streetwear_products is the one intentionally public-read table.
create policy "Public read" on streetwear_products
  for select using (true);
create policy "Service role write" on streetwear_products
  for all using (auth.role() = 'service_role');

-- ============================================================================
-- Storage: no manual step needed. The app creates the "garment-images"
-- bucket itself, lazily and idempotently, the first time anyone uploads a
-- photo (see app/api/garments/upload-image/route.ts and others):
--   adminClient.storage.createBucket("garment-images", { public: true })
-- ============================================================================
