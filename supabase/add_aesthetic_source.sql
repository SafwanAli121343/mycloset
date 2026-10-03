-- Distinguishes a user's own AestheticPicker choice (native Add Item screen) from an AI-inferred
-- aesthetic_tags value. Needed because both free and paid users can now set aesthetic_tags
-- themselves, but app/api/garments/route.ts's GET handler (and outfits/all-combos) strip
-- aesthetic_tags for a free/lapsed user as one of AI_GATED_FIELDS — without this column, that
-- stripping would also erase a user's own manual pick, which defeats the entire point of letting
-- free tier set one.
--
-- Run this in Supabase Dashboard -> SQL Editor -> New Query. Safe to run multiple times.

alter table garments add column if not exists aesthetic_source text;

-- Backfill: any existing row that already has aesthetic_tags predates this column and was only
-- ever set by AI (the manual picker didn't exist yet) — mark it 'ai' so it's still correctly
-- gated for free tier, rather than defaulting to null (which app code treats as "not manual,"
-- same effective behavior, but explicit here avoids relying on that default staying correct if
-- the gating logic ever changes).
update garments set aesthetic_source = 'ai' where aesthetic_tags is not null and aesthetic_source is null;
