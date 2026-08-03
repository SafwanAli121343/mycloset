// Applies the add_tags migration via Supabase's postgres.js compatible approach
// Uses the service role key to call a raw SQL endpoint

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://jhnwystsohdgzuvqnouy.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g"
);

// Test if tags column already exists by trying to select it
const { error } = await supabase.from("garments").select("tags").limit(1);
if (!error) {
  console.log("✓ tags column already exists");
  process.exit(0);
}
if (!error.message.includes("does not exist")) {
  console.error("Unexpected error:", error.message);
  process.exit(1);
}

// Column doesn't exist — tell the user to add it manually
console.log(`
The 'tags' JSONB column needs to be added to the garments table.

Go to: https://supabase.com/dashboard/project/jhnwystsohdgzuvqnouy/editor

Run this SQL:

ALTER TABLE garments ADD COLUMN IF NOT EXISTS tags JSONB;
CREATE INDEX IF NOT EXISTS idx_garments_tags ON garments USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_garments_tags_sw_cat ON garments USING GIN((tags->'streetwear_category'));
CREATE INDEX IF NOT EXISTS idx_garments_tags_features ON garments USING GIN((tags->'features'));
CREATE INDEX IF NOT EXISTS idx_garments_tags_aesthetic ON garments USING GIN((tags->'aesthetic'));

Then re-run: node scripts/reanalyze-garments.mjs
`);
