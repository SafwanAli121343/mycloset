-- Run in Supabase SQL Editor → New query

-- Add structured tags column (JSONB so each key is queryable independently)
ALTER TABLE garments ADD COLUMN IF NOT EXISTS tags JSONB;

-- GIN index lets you query e.g. tags->'streetwear_category' @> '["hype-streetwear"]'
CREATE INDEX IF NOT EXISTS idx_garments_tags ON garments USING GIN(tags);

-- Convenience indexes for the most common tag lookups
CREATE INDEX IF NOT EXISTS idx_garments_tags_sw_cat
  ON garments USING GIN((tags->'streetwear_category'));

CREATE INDEX IF NOT EXISTS idx_garments_tags_features
  ON garments USING GIN((tags->'features'));

CREATE INDEX IF NOT EXISTS idx_garments_tags_aesthetic
  ON garments USING GIN((tags->'aesthetic'));
