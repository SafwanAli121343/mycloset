import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/lib/db/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";

// Generic error — never reveal whether the email or password was wrong
const INVALID = "Invalid email or password.";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const user = await getUserByEmail(email).catch(() => null);

  // Run bcrypt even on a miss so timing stays constant (prevents timing attacks)
  const hashToCompare = user?.password_hash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000000";
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const token = await createSession({ userId: user.id, email: user.email });
  await setSessionCookie(token);

  // token is only consumed by the native app (stored via expo-secure-store, sent back as a
  // Bearer header — see lib/auth/session.ts); the web client relies on the httpOnly cookie
  // above and ignores this field entirely.
  return NextResponse.json({ id: user.id, email: user.email, token });
}
