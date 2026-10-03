import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { verificationStatus } from "@/lib/auth/verificationGate";

export async function GET(req: Request) {
  const rateBlock = applyApiRateLimit(req, "auth:me", 60, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json(null);

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json(null);

  return NextResponse.json({ id: user.id, email: user.email, ...verificationStatus(user) });
}
