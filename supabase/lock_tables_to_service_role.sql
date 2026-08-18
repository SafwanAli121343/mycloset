-- Security hardening: lock user-data tables to service-role-only access.
--
-- This app uses its own JWT-based auth (lib/auth/session.ts), not Supabase Auth — there is
-- never a Supabase Auth session, so auth.uid() can never match any row here. That means the
-- ONLY correct RLS policy for these tables is "service_role only" (same pattern already used
-- for wardrobe_analysis_state, see supabase/create_wardrobe_analysis_state.sql). All actual
-- per-user authorization is enforced in the Next.js API routes (session cookie -> userId ->
-- .eq("user_id", ...)), which all now use the service-role client.
--
-- Why this matters: NEXT_PUBLIC_SUPABASE_ANON_KEY is shipped to every browser bundle. If RLS
-- is NOT enabled (or is enabled with permissive/no policies) on these tables, anyone can open
-- a browser console, construct a Supabase client with that public anon key, and read/write/
-- delete ANY row directly — completely bypassing the Next.js API layer and its session checks.
--
-- Run this in Supabase Dashboard -> SQL Editor -> New Query.
-- Safe to run multiple times (IF NOT EXISTS / DROP POLICY IF EXISTS guards).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['garments', 'users', 'outfits', 'outfit_items', 'discovered_brands']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role only" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "Service role only" ON %I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t
    );
  END LOOP;
END $$;

-- After running this, verify in Dashboard -> Authentication -> Policies that each of these
-- tables shows RLS "Enabled" with exactly one "Service role only" policy, and separately spot
-- check from a browser console (using the anon key) that a read against e.g. `garments` now
-- returns an empty/error result instead of real rows.
