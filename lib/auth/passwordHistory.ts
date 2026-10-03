// Enforces "can't reuse a recently-used password" for both change-password and forgot-password
// reset. 90 days is the window: long enough that reuse checks actually mean something (a user
// cycling straight back to an old password minutes later defeats the point of resetting it at
// all), short enough not to force people into an ever-growing list of banned passwords forever.

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const REUSE_WINDOW_DAYS = 90;

export async function wasPasswordRecentlyUsed(
  userId: string,
  newPlainPassword: string,
  currentHash: string | null
): Promise<boolean> {
  if (currentHash && (await bcrypt.compare(newPlainPassword, currentHash))) return true;

  const since = new Date(Date.now() - REUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await adminSupabase
    .from("password_history")
    .select("password_hash")
    .eq("user_id", userId)
    .gte("created_at", since);

  for (const row of data ?? []) {
    if (await bcrypt.compare(newPlainPassword, row.password_hash)) return true;
  }
  return false;
}

// Call with the hash about to be REPLACED, before overwriting it, so it becomes part of the
// window that future resets/changes are checked against. Also prunes rows outside the window so
// this table doesn't grow unbounded for long-lived accounts.
export async function recordPasswordHistory(userId: string, oldHash: string): Promise<void> {
  await adminSupabase.from("password_history").insert({ user_id: userId, password_hash: oldHash });

  const cutoff = new Date(Date.now() - REUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await adminSupabase.from("password_history").delete().eq("user_id", userId).lt("created_at", cutoff);
}
