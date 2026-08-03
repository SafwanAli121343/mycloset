import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/users";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json(null);

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json(null);

  return NextResponse.json({ id: user.id, email: user.email });
}
