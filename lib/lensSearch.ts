export type VisualMatch = { title: string };

// Single SerpAPI Google Lens call, shared by brand resolution and attribute
// cross-referencing so we only pay for one reverse-image search per item.
export async function searchVisualMatches(imageUrl: string): Promise<VisualMatch[]> {
  const params = new URLSearchParams({
    api_key: process.env.SERPAPI_KEY!,
    engine: "google_lens",
    url: imageUrl,
  });

  const response = await fetch(`https://serpapi.com/search?${params.toString()}`);
  const data = await response.json();
  // Throw on an error response instead of returning [] — callers already treat a throw as "no
  // matches", and it keeps a failed lookup out of the shared cache (lib/aiGateway.ts).
  if (!response.ok || data.error) throw new Error(`lens: ${data.error ?? response.status}`);
  return data.visual_matches || [];
}
