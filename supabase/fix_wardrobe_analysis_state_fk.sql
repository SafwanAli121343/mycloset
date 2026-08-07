-- Fixes wardrobe_analysis_state.user_id: it was created referencing auth.users(id) (Supabase Auth),
-- but this app uses its own custom users table (lib/db/users.ts) with JWT-based auth, not Supabase
-- Auth. No row ever satisfied the auth.users FK, so every PUT /api/wardrobe/state has been failing
-- with "violates foreign key constraint wardrobe_analysis_state_user_id_fkey" since this table was
-- created — wardrobe level state has only ever persisted to browser localStorage, never to the DB.
-- Run in Supabase SQL editor (Dashboard -> SQL Editor -> New Query).

ALTER TABLE wardrobe_analysis_state
  DROP CONSTRAINT IF EXISTS wardrobe_analysis_state_user_id_fkey;

ALTER TABLE wardrobe_analysis_state
  ADD CONSTRAINT wardrobe_analysis_state_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- The RLS policy also referenced auth.uid(), which is always null here since no Supabase Auth
-- session is ever created — the policy has never matched anything. All real access goes through
-- the API routes using the service-role key, which bypasses RLS entirely, so this was inert rather
-- than a security hole. Replaced with the service-role-only pattern already used by
-- streetwear_products.sql for consistency.
DROP POLICY IF EXISTS "Users manage their own wardrobe analysis state" ON wardrobe_analysis_state;

CREATE POLICY "Service role manages wardrobe analysis state"
  ON wardrobe_analysis_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
