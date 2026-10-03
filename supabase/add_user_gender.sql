-- User's gender (Settings → GENDER & AGE), read by every AI style-analysis prompt alongside age
-- (lib/userAge.ts). Null = not set; the prompts then simply omit it.
alter table users add column if not exists gender text
  check (gender is null or gender in ('male', 'female', 'unisex'));
