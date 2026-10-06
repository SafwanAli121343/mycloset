import { NextRequest } from "next/server";
import { removeBackgroundQueued } from "@/lib/bgRemoval";
import sharp from "sharp";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { assertSafeUrl } from "@/lib/security/ssrfGuard";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Background removal is expensive — require auth and limit to 30/hour per IP
  const rateBlock = applyApiRateLimit(req, "remove-bg", 1000, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : null;
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

  try {
    let inputBlob: Blob;
    if (url.startsWith("data:")) {
      // Validate it's an image data URI before processing
      if (!url.startsWith("data:image/")) {
        return Response.json({ error: "Only image data URIs are accepted." }, { status: 400 });
      }
      const [header, b64] = url.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
      const raw  = Buffer.from(b64, "base64");
      // Convert to JPEG — AVIF and other exotic formats can't be passed directly
      const jpegBuf = await sharp(raw).jpeg({ quality: 90 }).toBuffer();
      inputBlob = new Blob([new Uint8Array(jpegBuf)], { type: "image/jpeg" });
    } else {
      // SSRF guard — block internal/private network URLs before fetching
      assertSafeUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`fetch: ${res.status}`);
      // Only accept image content types from remote URLs
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.startsWith("image/")) {
        return Response.json({ error: "Remote URL did not return an image." }, { status: 400 });
      }
      const buf = await res.arrayBuffer();
      inputBlob = new Blob([buf], { type: ct.split(";")[0] });
    }

    const blob   = await removeBackgroundQueued(inputBlob);
    const buffer = Buffer.from(await blob.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SSRF")) {
      return Response.json({ error: "Invalid URL." }, { status: 400 });
    }
    return Response.json({ error: "Background removal failed" }, { status: 500 });
  }
}
