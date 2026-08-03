-- Paste this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS streetwear_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         TEXT NOT NULL,
  title         TEXT NOT NULL,
  price         NUMERIC,
  price_text    TEXT,
  image_url     TEXT,
  product_url   TEXT NOT NULL,
  category      TEXT,        -- top | bottom | footwear | outerwear | accessory
  sub_type      TEXT,        -- hoodie | cargo pants | bomber jacket | etc.
  color_primary TEXT,        -- black | white | navy | etc.
  aesthetic_tags TEXT[],     -- {streetwear, workwear, vintage, ...}
  gender        TEXT DEFAULT 'unisex',  -- male | female | unisex
  brand_tier    TEXT,        -- budget | mid | premium | luxury
  source_domain TEXT,
  in_stock      BOOLEAN DEFAULT TRUE,
  analyzed      BOOLEAN DEFAULT FALSE,
  scraped_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sw_products_url_uq UNIQUE (product_url)
);

-- Full-text search on title + brand
CREATE INDEX IF NOT EXISTS idx_sw_fts
  ON streetwear_products
  USING GIN(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(brand,'')));

CREATE INDEX IF NOT EXISTS idx_sw_cat    ON streetwear_products(category);
CREATE INDEX IF NOT EXISTS idx_sw_gender ON streetwear_products(gender);
CREATE INDEX IF NOT EXISTS idx_sw_brand  ON streetwear_products(brand);
CREATE INDEX IF NOT EXISTS idx_sw_tier   ON streetwear_products(brand_tier);

-- Allow public reads, restrict writes to service role
ALTER TABLE streetwear_products ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='streetwear_products' AND policyname='Public read') THEN
    CREATE POLICY "Public read"        ON streetwear_products FOR SELECT USING (true);
    CREATE POLICY "Service role write" ON streetwear_products FOR ALL    USING (auth.role() = 'service_role');
  END IF;
END $$;
