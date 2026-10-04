// iOS release builds refuse plain http:// (App Transport Security), so an image saved with one
// never loads in the App Store app — even though it worked in Expo Go, which doesn't enforce it.
// Store pages often still publish http:// image links (Shopify's og:image does); every one of
// those CDNs also serves https, so upgrade the scheme rather than drop the image.
export function secureImageUrl<T extends string | null | undefined>(url: T): T {
  return (typeof url === "string" && url.startsWith("http://") ? "https://" + url.slice(7) : url) as T;
}
