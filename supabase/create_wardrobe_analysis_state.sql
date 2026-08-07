-- Persists wardrobe analysis history + attributed crossed entries per user.
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
--
-- user_id references this app's own `users` table (custom JWT auth, see lib/db/users.ts),
-- NOT Supabase's auth.users — this app never creates Supabase Auth sessions, so a FK to
-- auth.users would never match any real user_id and every write would fail.
CREATE TABLE IF NOT EXISTS wardrobe_analysis_state (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  analysis_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  crossed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level    integer NOT NULL DEFAULT 1,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE wardrobe_analysis_state ENABLE ROW LEVEL SECURITY;

-- All access to this table goes through the API routes using the service-role key (this app
-- has no Supabase Auth sessions, so auth.uid()-based policies would never match anything).
CREATE POLICY "Service role manages wardrobe analysis state"
  ON wardrobe_analysis_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
