import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCS } from "@/lib/legal/content";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

// GET /api/legal/[doc] — doc is one of terms|privacy|eula|cookies. Public, no auth: the native
// app reads this to render the document in-app (see native/screens/LegalScreen.tsx) instead of
// opening a browser, and a prospective user should be able to read these before ever signing up.
export async function GET(req: NextRequest, { params }: { params: Promise<{ doc: string }> }) {
  const rateBlock = applyApiRateLimit(req, "legal", 60, 60 * 1000);
  if (rateBlock) return rateBlock;

  const { doc } = await params;
  const entry = (LEGAL_DOCS as Record<string, (typeof LEGAL_DOCS)[keyof typeof LEGAL_DOCS]>)[doc];
  if (!entry) return NextResponse.json({ error: "Unknown document" }, { status: 404 });

  return NextResponse.json(entry, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
