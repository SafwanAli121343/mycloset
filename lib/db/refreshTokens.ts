import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

// Requires the refresh_tokens table in Supabase (manual setup):
//   CREATE TABLE refresh_tokens (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//     token_hash text NOT NULL UNIQUE,
//     expires_at timestamptz NOT NULL,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   CREATE INDEX ON refresh_tokens(user_id);

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const REFRESH_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the raw token (send to client) and stores its hash in the DB.
export async function createRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(40).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await adminSupabase
    .from("refresh_tokens")
    .insert({ user_id: userId, token_hash: hash, expires_at: expiresAt });
  if (error) throw error;

  return raw;
}

// Validates and rotates: deletes the used token, issues a new one.
// Returns null if the token is invalid or expired.
export async function rotateRefreshToken(rawToken: string): Promise<{ userId: string; newToken: string } | null> {
  const hash = hashToken(rawToken);

  const { data, error } = await adminSupabase
    .from("refresh_tokens")
    .select("id, user_id, expires_at")
    .eq("token_hash", hash)
    .single();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await adminSupabase.from("refresh_tokens").delete().eq("id", data.id);
    return null;
  }

  // Delete the used token (rotation)
  await adminSupabase.from("refresh_tokens").delete().eq("id", data.id);

  // Issue a new one
  const newToken = await createRefreshToken(data.user_id);
  return { userId: data.user_id, newToken };
}

// Revokes all refresh tokens for a user (on logout or account deletion).
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await adminSupabase.from("refresh_tokens").delete().eq("user_id", userId).then(() => {});
}
