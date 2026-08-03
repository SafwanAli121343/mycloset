-- Run in Supabase SQL Editor after add_refresh_columns.sql

ALTER TABLE streetwear_products
  ADD COLUMN IF NOT EXISTS source_links JSONB DEFAULT '[]';

-- Index for efficient brand+title dedup lookups when scraping retailers
CREATE INDEX IF NOT EXISTS idx_sw_brand_title
  ON streetwear_products (brand, LOWER(title));
