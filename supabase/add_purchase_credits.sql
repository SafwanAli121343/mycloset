-- One-time purchases, tracked per type (Settings → PLAN shows each balance):
--   users.ai_credits            = "Single Item Analysis" balance (existing column — 1 per purchase)
--   users.wardrobe_scan_credits = "Full Wardrobe Analysis" balance (1 per purchase)
-- garments.ai_unlocked: this item's AI analysis was paid for with a one-time purchase, so a
-- free user can see its AI details (pros/cons/aesthetic/pairings) even without Pro.
alter table users add column if not exists wardrobe_scan_credits integer not null default 0
  check (wardrobe_scan_credits >= 0);
alter table garments add column if not exists ai_unlocked boolean not null default false;
