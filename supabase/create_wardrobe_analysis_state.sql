-- Persists wardrobe analysis history + attributed crossed entries per user.
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
CREATE TABLE IF NOT EXISTS wardrobe_analysis_state (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  crossed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level    integer NOT NULL DEFAULT 1,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE wardrobe_analysis_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own wardrobe analysis state"
  ON wardrobe_analysis_state
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
