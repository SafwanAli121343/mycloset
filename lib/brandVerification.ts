// Verifies whether a candidate word is a recognized clothing/footwear brand
// via a plain Google search (same SerpAPI account as Lens, different engine).
// This lets us trust a title's leading word as the brand even when it's not
// in our curated list — the alternative is relying on Cloud Vision/Lens
// "visual similarity" guesses, which can confidently confuse a niche brand's
// logo for a famous brand's similarly-styled one.
export async function verifyBrandCandidate(candidate: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      api_key: process.env.SERPAPI_KEY!,
      engine: "google",
      q: `"${candidate}" clothing brand`,
      num: "5",
    });

    const response = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const data = await response.json();

    const needle = candidate.toLowerCase();
    const brandSignal = /brand|clothing|apparel|fashion|streetwear|denim|footwear|label/;

    const kg = data.knowledge_graph;
    if (kg) {
      const kgText = `${kg.title || ""} ${kg.type || ""} ${kg.description || ""}`.toLowerCase();
      if (kgText.includes(needle) && brandSignal.test(kgText)) return true;
    }

    const organic = (data.organic_results || []) as { title?: string; snippet?: string }[];
    const hits = organic.slice(0, 5).filter((r) => {
      const text = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
      return text.includes(needle) && brandSignal.test(text);
    });

    return hits.length >= 2;
  } catch {
    return false;
  }
}
