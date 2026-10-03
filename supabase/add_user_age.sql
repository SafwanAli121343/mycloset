-- User's age (optional), set from Settings → GENDER & AGE. Read by every AI style-analysis prompt
-- (see lib/userAge.ts) so judgments like age-appropriateness and what reads as current are
-- tailored to the user. Null = not set; the prompts then simply omit it.
alter table users add column if not exists age smallint
  check (age is null or (age between 13 and 120));
