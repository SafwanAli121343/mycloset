// GET /api/billing/web/config → { enabled, publishableKey } — whether website checkout is set up.
import { NextResponse } from "next/server";
import { webPaymentsEnabled } from "@/lib/billing/stripe";

export async function GET() {
  return NextResponse.json({
    enabled: webPaymentsEnabled(),
    publishableKey: webPaymentsEnabled() ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : null,
  });
}
