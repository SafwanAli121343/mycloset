-- Messages users send from the Feedback page (app: Settings → FEEDBACK; website: Settings →
-- Feedback). View them in Supabase → Table Editor → feedback (newest first: sort by created_at).
-- Only the server (service role) can read or write this table — RLS is on with no policies.
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  email       text,
  platform    text,
  message     text not null check (char_length(message) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index if not exists idx_feedback_created_at on feedback (created_at desc);
alter table feedback enable row level security;
