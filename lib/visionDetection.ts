export type LogoTextResult = {
  detectedLogos: string[];
  ocrText: string;
};

// One Cloud Vision call covering both LOGO_DETECTION (Google's own logo
// recognition — can identify brands outside our curated list) and
// TEXT_DETECTION (OCR for anything printed on the garment, including care
// labels with material composition).
export async function detectLogoAndText(imageUrl: string): Promise<LogoTextResult> {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_CLOUD_VISION_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { source: { imageUri: imageUrl } },
            features: [{ type: "LOGO_DETECTION" }, { type: "TEXT_DETECTION" }],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  const result = data.responses?.[0] || {};

  return {
    detectedLogos: (result.logoAnnotations || []).map((l: { description: string }) => l.description),
    ocrText: result.fullTextAnnotation?.text || "",
  };
}
