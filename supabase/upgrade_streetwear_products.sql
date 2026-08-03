-- Upgrade streetwear_products with full analysis fields
-- Run in Supabase SQL Editor

ALTER TABLE streetwear_products
  ADD COLUMN IF NOT EXISTS color_secondary  TEXT,
  ADD COLUMN IF NOT EXISTS fit              TEXT,
  ADD COLUMN IF NOT EXISTS pattern          TEXT,
  ADD COLUMN IF NOT EXISTS material         TEXT,
  ADD COLUMN IF NOT EXISTS formality        TEXT,
  ADD COLUMN IF NOT EXISTS tags             JSONB,
  ADD COLUMN IF NOT EXISTS pros             TEXT[],
  ADD COLUMN IF NOT EXISTS cons             TEXT[];

-- Normalize existing color_primary values to Title Case standard palette
UPDATE streetwear_products SET color_primary =
  CASE LOWER(color_primary)
    WHEN 'black'      THEN 'Black'
    WHEN 'white'      THEN 'White'
    WHEN 'grey'       THEN 'Gray'
    WHEN 'gray'       THEN 'Gray'
    WHEN 'blue'       THEN 'Blue'
    WHEN 'navy'       THEN 'Navy'
    WHEN 'red'        THEN 'Red'
    WHEN 'green'      THEN 'Green'
    WHEN 'brown'      THEN 'Brown'
    WHEN 'beige'      THEN 'Beige'
    WHEN 'yellow'     THEN 'Yellow'
    WHEN 'orange'     THEN 'Orange'
    WHEN 'pink'       THEN 'Pink'
    WHEN 'purple'     THEN 'Purple'
    WHEN 'multicolor' THEN 'Multicolor'
    WHEN 'cream'      THEN 'Cream'
    WHEN 'ivory'      THEN 'Cream'
    WHEN 'off-white'  THEN 'Off-White'
    WHEN 'tan'        THEN 'Tan'
    WHEN 'khaki'      THEN 'Khaki'
    WHEN 'olive'      THEN 'Olive'
    WHEN 'burgundy'   THEN 'Burgundy'
    WHEN 'silver'     THEN 'Silver'
    WHEN 'gold'       THEN 'Gold'
    WHEN 'camel'      THEN 'Camel'
    WHEN 'rust'       THEN 'Rust'
    WHEN 'teal'       THEN 'Teal'
    ELSE INITCAP(color_primary)
  END
WHERE color_primary IS NOT NULL;

-- Normalize sub_type "top" → specific types based on title keywords
UPDATE streetwear_products SET sub_type =
  CASE
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%hoodie%'           THEN 'Hoodie'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%sweatshirt%'       THEN 'Sweatshirt'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%crewneck%'         THEN 'Sweatshirt'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%polo%'             THEN 'Polo'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%long sleeve%'      THEN 'Long Sleeve Tee'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%longsleeve%'       THEN 'Long Sleeve Tee'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%l/s%'              THEN 'Long Sleeve Tee'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%ls tee%'           THEN 'Long Sleeve Tee'
    WHEN sub_type = 'top' AND (LOWER(title) LIKE '%t-shirt%' OR LOWER(title) LIKE '% tee%') THEN 'T-Shirt'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%shirt%'            THEN 'Shirt'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%tank%'             THEN 'Tank Top'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%vest%'             THEN 'Vest'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%jersey%'           THEN 'Jersey'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%fleece%'           THEN 'Fleece'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%knitwear%'         THEN 'Knitwear'
    WHEN sub_type = 'top' AND (LOWER(title) LIKE '%knit%' OR LOWER(title) LIKE '%sweater%') THEN 'Knitwear'
    WHEN sub_type = 'top' AND LOWER(title) LIKE '%cardigan%'         THEN 'Cardigan'
    ELSE sub_type
  END
WHERE sub_type = 'top';

-- Also normalize other generic sub_types
UPDATE streetwear_products SET sub_type =
  CASE
    WHEN sub_type = 'bottom' AND (LOWER(title) LIKE '%jean%' OR LOWER(title) LIKE '%denim%') THEN 'Jeans'
    WHEN sub_type = 'bottom' AND LOWER(title) LIKE '%cargo%' THEN 'Cargo Pants'
    WHEN sub_type = 'bottom' AND LOWER(title) LIKE '%short%' THEN 'Shorts'
    WHEN sub_type = 'bottom' AND (LOWER(title) LIKE '%jogger%' OR LOWER(title) LIKE '%sweatpant%' OR LOWER(title) LIKE '%track pant%') THEN 'Track Pants'
    WHEN sub_type = 'bottom' AND LOWER(title) LIKE '%trouser%' THEN 'Trousers'
    WHEN sub_type = 'bottom' AND LOWER(title) LIKE '%skirt%' THEN 'Skirt'
    WHEN sub_type = 'bottom' AND LOWER(title) LIKE '%pant%' THEN 'Pants'
    WHEN sub_type = 'sneaker' THEN 'Sneakers'
    ELSE sub_type
  END
WHERE sub_type IN ('bottom', 'sneaker');

-- Normalize aesthetic_tags vocabulary to our standard 24-tag system
-- 'luxury' → 'quiet-luxury' or 'old-money' (determined by brand_tier)
UPDATE streetwear_products
SET aesthetic_tags = array_replace(aesthetic_tags, 'luxury', 'quiet-luxury')
WHERE aesthetic_tags @> ARRAY['luxury'];

UPDATE streetwear_products
SET aesthetic_tags = array_replace(aesthetic_tags, 'avantgarde', 'high-fashion')
WHERE aesthetic_tags @> ARRAY['avantgarde'];

UPDATE streetwear_products
SET aesthetic_tags = array_replace(aesthetic_tags, 'sportswear', 'athleisure')
WHERE aesthetic_tags @> ARRAY['sportswear'];

UPDATE streetwear_products
SET aesthetic_tags = array_replace(aesthetic_tags, 'athletic', 'athleisure')
WHERE aesthetic_tags @> ARRAY['athletic'];

-- GIN index on tags for fast queries
CREATE INDEX IF NOT EXISTS idx_sw_products_tags ON streetwear_products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_sw_products_aesthetic ON streetwear_products USING GIN(aesthetic_tags);
