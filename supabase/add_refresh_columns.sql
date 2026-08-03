-- Run this in Supabase SQL Editor after the main streetwear_products.sql

ALTER TABLE streetwear_products
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_failures   INTEGER DEFAULT 0;

-- Index so the refresh query can efficiently find stale items
CREATE INDEX IF NOT EXISTS idx_sw_last_checked
  ON streetwear_products(last_checked_at NULLS FIRST);
