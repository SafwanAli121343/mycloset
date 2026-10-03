-- Website purchases (Stripe — lib/billing/stripe.ts). Safe to run more than once.
-- The account's Stripe customer and its current website subscription, so the webhook can match a
-- payment to the account and Settings can show / cancel the subscription.
alter table users add column if not exists stripe_customer_id text;
alter table users add column if not exists stripe_subscription_id text;
create unique index if not exists users_stripe_customer_id on users (stripe_customer_id) where stripe_customer_id is not null;
