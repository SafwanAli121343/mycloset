import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "register"
  | "account_deleted"
  | "data_exported"
  | "password_changed"
  | "password_reset"
  | "email_verified"
  | "tier_changed"
  | "key_redeemed"
  | "key_redeem_failed";

// Best-effort write to the audit_log table — never awaited on the critical path.
// Requires the audit_log table to exist in Supabase:
//   CREATE TABLE audit_log (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id text,
//     action text NOT NULL,
//     ip text,
//     metadata jsonb,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
export function auditLog(
  action: AuditAction,
  userId: string | null,
  ip: string | null,
  metadata?: Record<string, unknown>
): void {
  void adminClient
    .from("audit_log")
    .insert({ user_id: userId, action, ip, metadata: metadata ?? null })
    .then(null, () => {});
}
