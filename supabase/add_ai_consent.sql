-- Whether the user agreed to have their data (clothing photos, item details, wardrobe, and age /
-- gender if set) sent to OpenAI for AI analysis — App Store guideline 5.1.2(i) requires explicit
-- permission before sharing personal data with a third-party AI. null = not asked yet,
-- true = allowed, false = declined. Every AI call checks it (lib/billing/entitlements.ts).
alter table users add column if not exists ai_consent boolean;
