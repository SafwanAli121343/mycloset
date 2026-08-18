import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createUser, getUserByEmail } from "@/lib/db/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // Check if email already taken — use a generic message to prevent enumeration
  const existing = await getUserByEmail(email).catch(() => null);
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser(email, passwordHash);

  const token = await createSession({ userId: user.id, email: user.email });
  await setSessionCookie(token);

  // token is only consumed by the native app — see comment in app/api/auth/login/route.ts.
  return NextResponse.json({ id: user.id, email: user.email, token }, { status: 201 });
}
