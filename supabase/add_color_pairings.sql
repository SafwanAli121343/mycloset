-- Add color_pairings and color_clashes to streetwear_products
-- Run in Supabase SQL Editor

ALTER TABLE streetwear_products
  ADD COLUMN IF NOT EXISTS color_pairings  TEXT[],
  ADD COLUMN IF NOT EXISTS color_clashes   TEXT[];
