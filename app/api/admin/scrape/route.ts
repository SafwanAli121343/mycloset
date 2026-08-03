import { NextRequest, NextResponse } from "next/server";
import { getProductStore } from "@/lib/stores/products";

// GET /api/admin/scrape — DB stats (used by admin page)
export async function GET(req: NextRequest) {
  const pin = req.headers.get("x-admin-pin");
  if (pin !== process.env.ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const store = getProductStore();
  const stats = await store.stats();
  return NextResponse.json(stats);
}
