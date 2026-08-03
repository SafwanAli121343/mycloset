import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { inferGarmentAttributes } from "@/lib/aiInference";

export const maxDuration = 30;

// POST /api/preview/deep-analyze
// Body: { title, brand, category, color_primary, material, fit, image }
// Returns: { sub_type, aesthetic_tags, pros, cons, color_pairings, color_clashes, formality }
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    title?: string; brand?: string; category?: string;
    color_primary?: string; material?: string; fit?: string; image?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { title, brand, category, color_primary, material, fit, image } = body;
  if (!title || !category || !image) {
    return NextResponse.json({ error: "title, category, and image required" }, { status: 400 });
  }

  const FIELDS = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern"];

  try {
    const result = await inferGarmentAttributes(
      {
        title,
        category,
        subType: null,
        brand: brand ?? null,
        colorPrimary: color_primary ?? null,
        fit: fit ?? null,
        material: material ?? null,
        image,
      },
      FIELDS
    );
    return NextResponse.json(result.values);
  } catch (err) {
    console.error("[preview/deep-analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
