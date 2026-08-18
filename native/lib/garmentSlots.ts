export type Bucket = "head" | "outer" | "top" | "mid" | "bottom" | "shoes" | "accessory";

export const BUCKET_LABEL: Record<Bucket, string> = {
  head: "Head", outer: "Outerwear", top: "Top", mid: "Mid Layer",
  bottom: "Bottom", shoes: "Shoes", accessory: "Accessories",
};

export type SlotGarment = {
  id: string; image: string | null; category: string | null; sub_type: string | null;
};

// Same classification the website's calendar/builder desktop grid uses (app/calendar/page.tsx,
// around the outfit slot grid) — kept in sync by hand since native is a separate codebase.
export function bucketOf(g: SlotGarment): Bucket {
  if (g.category === "footwear") return "shoes";
  if (g.category === "bottom") return "bottom";
  if (g.category === "outerwear") return "outer";
  // sub_type-based hat detection runs BEFORE the category === "accessory" fallback below — hats
  // commonly get category "accessory" from the AI tagger (a reasonable classification on its
  // own), which used to claim them here first, so a hat could never actually resolve to "head"
  // and land in the dedicated Hat slot — dragging one there just deposited it in Accessories.
  const sub = (g.sub_type ?? "").toLowerCase();
  if (sub.includes("hat") || sub.includes("cap") || sub.includes("beanie") || sub.includes("bucket") || sub.includes("beret") || sub.includes("snapback")) {
    return "head";
  }
  if (g.category === "accessory") return "accessory";
  if (sub.includes("hoodie") || sub.includes("sweatshirt") || sub.includes("zip-up") || sub.includes("zip up") ||
      sub.includes("sweater") || sub.includes("pullover") || sub.includes("crewneck") || sub.includes("fleece") || sub.includes("cardigan")) {
    return "mid";
  }
  return "top";
}

// Direct port of app/calendar/page.tsx's isOuterCapableTop(): distinguishes true base layers
// (tees, henleys, thermals) from tops that can also function as an outer-capable layering piece
// (oxfords, flannels, button-ups) — used to sort a bucket's "top" items so a real base layer
// always lands in the base/center slot instead of whichever top happened to be added first.
export function isOuterCapableTop(g: SlotGarment): boolean {
  const sub = (g.sub_type ?? "").toLowerCase();
  return (
    sub.includes("flannel") || sub.includes("oxford") || sub.includes("camp collar") ||
    sub.includes("bowling") || sub.includes("western") || sub.includes("chambray") ||
    sub.includes("button-up") || sub.includes("button up") ||
    sub.includes("button-down") || sub.includes("button down") ||
    sub.includes("dress shirt") || sub.includes("work shirt") ||
    sub.includes("linen shirt") || sub.includes("denim shirt") ||
    sub.includes("printed shirt") || sub.includes("silk shirt") ||
    sub.includes("rugby") ||
    (sub.includes("polo") && !sub.includes("polo neck"))
  );
}

// Same ordering the website applies before reading tops[0] as the base/center slot: true base
// items first, outer-capable tops last — stable sort, so items within each group keep whatever
// order they arrived in.
export function sortTops<T extends SlotGarment>(tops: T[]): T[] {
  return [...tops].sort((a, b) => (isOuterCapableTop(a) ? 1 : 0) - (isOuterCapableTop(b) ? 1 : 0));
}
