-- Adds highest_score to wardrobe_analysis_state so the score high-water mark
-- survives page reloads and cannot regress across sessions.
-- Run in Supabase Dashboard → SQL Editor → New Query.
ALTER TABLE wardrobe_analysis_state
  ADD COLUMN IF NOT EXISTS highest_score integer;
