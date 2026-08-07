-- ── Diagnostic: run these SELECT queries first to see what will be deleted ──────
-- SELECT category, COUNT(*) FROM streetwear_products GROUP BY category ORDER BY COUNT(*) DESC;
-- SELECT sub_type, COUNT(*) FROM streetwear_products WHERE category = 'accessory' GROUP BY sub_type ORDER BY COUNT(*) DESC LIMIT 40;

-- ── Step 1: Delete clear non-clothing items by title keyword ─────────────────────
-- These appear in all categories due to how brands were scraped (Supreme sells
-- skate decks, stickers, toys; off-white sold home goods, etc.)

DELETE FROM streetwear_products
WHERE
  -- Skateboard gear
  LOWER(title) LIKE '%skateboard%'
  OR LOWER(title) LIKE '%skate deck%'
  OR LOWER(title) LIKE '%longboard%'
  OR LOWER(title) LIKE '%grip tape%'
  OR (LOWER(title) LIKE '% deck%' AND category = 'accessory')
  OR LOWER(title) LIKE '%skate wheel%'

  -- Stickers / patches / pins / decals
  OR LOWER(title) LIKE '%sticker%'
  OR LOWER(title) LIKE '% patch%'
  OR LOWER(title) LIKE '%decal%'
  OR LOWER(title) LIKE '% pin %'
  OR LOWER(title) LIKE '% pins'
  OR LOWER(title) LIKE '% badge%'
  OR LOWER(title) LIKE '%enamel pin%'

  -- Home goods / kitchenware
  OR LOWER(title) LIKE '% candle%'
  OR LOWER(title) LIKE '% mug%'
  OR LOWER(title) LIKE '%incense%'
  OR LOWER(title) LIKE '% tray%'
  OR LOWER(title) LIKE '%ashtray%'
  OR LOWER(title) LIKE '% lighter%'
  OR LOWER(title) LIKE '%rolling tray%'
  OR LOWER(title) LIKE '%grinder%'
  OR LOWER(title) LIKE '% plate%'
  OR LOWER(title) LIKE '%vase%'

  -- Collectibles / toys
  OR LOWER(title) LIKE '%figure%'
  OR LOWER(title) LIKE '% toy%'
  OR LOWER(title) LIKE '%plush%'
  OR LOWER(title) LIKE '%stuffed%'
  OR LOWER(title) LIKE '%action figure%'
  OR LOWER(title) LIKE '%model kit%'

  -- Printed media / art
  OR LOWER(title) LIKE '%poster%'
  OR LOWER(title) LIKE '%magazine%'
  OR LOWER(title) LIKE '% zine%'
  OR LOWER(title) LIKE '%lookbook%'
  OR LOWER(title) LIKE '%art print%'
  OR LOWER(title) LIKE '%litho%'

  -- Tech / phone
  OR LOWER(title) LIKE '%phone case%'
  OR LOWER(title) LIKE '%phone cover%'
  OR LOWER(title) LIKE '%airpod%'
  OR LOWER(title) LIKE '%air pod%'
  OR LOWER(title) LIKE '%airtag%'
  OR LOWER(title) LIKE '%usb cable%'

  -- Small non-wearable accessories
  OR LOWER(title) LIKE '%keychain%'
  OR LOWER(title) LIKE '%key chain%'
  OR LOWER(title) LIKE '%key ring%'
  OR LOWER(title) LIKE '%lanyard%'
  OR LOWER(title) LIKE '%playing card%'
  OR LOWER(title) LIKE '%card game%'
  OR LOWER(title) LIKE '%dice%'
;

-- ── Step 2: Delete non-wearable accessory sub-types ─────────────────────────────
-- Keeps hats, scarves, belts, gloves, socks (all wearable). Removes bags, wallets,
-- and other carried/non-worn accessories that don't contribute to outfit analysis.

DELETE FROM streetwear_products
WHERE category = 'accessory'
  AND LOWER(COALESCE(sub_type, '')) IN (
    'bag', 'backpack', 'tote', 'tote bag', 'messenger bag', 'crossbody bag',
    'crossbody', 'shoulder bag', 'duffel bag', 'duffle', 'gym bag', 'fanny pack',
    'waist bag', 'bum bag', 'clutch', 'pouch',
    'wallet', 'card holder', 'card case', 'coin purse', 'purse',
    'skateboard', 'deck', 'wheels', 'trucks', 'bearings',
    'sticker', 'patch', 'pin', 'badge',
    'toy', 'figure', 'plush',
    'book', 'magazine', 'zine', 'poster',
    'phone case', 'tech', 'electronics',
    'keychain', 'key chain', 'lanyard'
  );

-- ── Step 3: Delete title-matched bags/wallets that may have other categories ────
DELETE FROM streetwear_products
WHERE
  (LOWER(title) LIKE '% bag' OR LOWER(title) LIKE '% bag %' OR LOWER(title) LIKE '% bags%')
  AND category = 'accessory'
  AND LOWER(COALESCE(sub_type,'')) NOT IN ('sleeping bag');  -- keep if somehow a sleeping-bag garment

DELETE FROM streetwear_products
WHERE
  (LOWER(title) LIKE '%wallet%' OR LOWER(title) LIKE '%card holder%')
  AND category = 'accessory';

-- ── Step 4: Delete unanalyzed items in the accessory category ───────────────────
-- Unanalyzed accessories have no analysis data and contribute nothing to shopping
-- recommendations. Clothing items (top/bottom/footwear/outerwear) are kept even
-- if unanalyzed because they may be analyzed in future scraping runs.

DELETE FROM streetwear_products
WHERE category = 'accessory'
  AND (analyzed IS FALSE OR analyzed IS NULL);

-- ── Step 5: ANALYZE to update query planner stats after the large delete ─────────
ANALYZE streetwear_products;

-- ── Optional: check remaining row count ──────────────────────────────────────────
-- SELECT COUNT(*) FROM streetwear_products;
-- SELECT category, COUNT(*) FROM streetwear_products GROUP BY category ORDER BY COUNT(*) DESC;
