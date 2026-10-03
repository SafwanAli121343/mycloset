import { NextRequest, NextResponse } from "next/server";
import { getProductStore } from "@/lib/stores/products";
import { checkAdminPin } from "@/lib/auth/adminPin";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

// GET /api/admin/scrape — DB stats (used by admin page)
export async function GET(req: NextRequest) {
  // Rate-limit admin PIN routes to prevent brute-force — 10 attempts per 15 min per IP
  const rateBlock = applyApiRateLimit(req, "admin:scrape", 10, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  if (!checkAdminPin(req.headers.get("x-admin-pin"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const store = getProductStore();
  const stats = await store.stats();
  return NextResponse.json(stats);
}

// POST /api/admin/scrape — the admin page's scrape buttons call this, but the actual
// scraping logic (scrapeShopify/scrapeFirecrawl in scripts/scrape-products.mjs) is written
// as a long-running CLI script (streams progress to stdout, calls process.exit, takes
// minutes per source) and isn't safely callable from a request/response API route without a
// real rewrite. Returning a clear, honest JSON error here (rather than 404/405ing with no
// body, which the admin page's `res.json()` was throwing a SyntaxError on) so the button
// fails visibly instead of silently/confusingly. Run scrapes via the CLI script for now:
//   npx tsx --env-file=.env.local scripts/scrape-products.mjs <brand...>
export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "admin:scrape", 10, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  if (!checkAdminPin(req.headers.get("x-admin-pin"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Scraping from the admin UI isn't wired up yet — run `npx tsx --env-file=.env.local scripts/scrape-products.mjs <brand>` from the terminal instead." },
    { status: 501 },
  );
}
