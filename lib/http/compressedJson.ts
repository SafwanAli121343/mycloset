import { gzipSync } from "zlib";

// Next.js gzips pages and static files but not route-handler responses, so the big JSON lists
// (closet, scores, every outfit combination) went over the wire uncompressed — ~500 KB for a
// 26-piece closet's outfits. This gzips them when the client accepts it (browsers and the app's
// fetch both do, and decompress transparently). Small bodies aren't worth the CPU.
export function compressedJson(req: Request, data: unknown, init: ResponseInit = {}): Response {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (body.length < 8192 || !/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
    return new Response(body, { ...init, headers });
  }
  headers.set("Content-Encoding", "gzip");
  headers.append("Vary", "Accept-Encoding");
  return new Response(new Uint8Array(gzipSync(body)), { ...init, headers });
}
