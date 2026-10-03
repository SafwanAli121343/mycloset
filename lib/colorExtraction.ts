import sharp from "sharp";
import { NAMED_COLORS } from "./constants/colors";

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116;
}

// Converts sRGB to CIE Lab (D65 white point). Lab distance tracks human
// color perception much better than RGB distance, which matters once the
// named-color palette is dense enough that "nearest by RGB" can pick a
// same-lightness-but-wrong-hue neighbor over a slightly-farther-but-same-hue
// one.
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistSq(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

const NAMED_COLORS_LAB = NAMED_COLORS.map((c) => ({
  name: c.name,
  lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]),
}));

function nearestColorName(r: number, g: number, b: number): string {
  const lab = rgbToLab(r, g, b);
  let closest = NAMED_COLORS_LAB[0].name;
  let minDistance = Infinity;

  for (const color of NAMED_COLORS_LAB) {
    const distance = labDistSq(lab, color.lab);
    if (distance < minDistance) {
      minDistance = distance;
      closest = color.name;
    }
  }

  return closest;
}

export type ColorResult = {
  primary: string | null;
  primaryRgb: [number, number, number] | null;
  secondary: string | null;
  secondaryRgb: [number, number, number] | null;
  colors: string[]; // all significant colors ranked by prevalence, near-duplicates collapsed
};

const RESIZE = 100;

type RGB = [number, number, number];

function distSq(a: RGB, b: RGB): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// (max - min) / max, i.e. how far a color is from gray. Used to weight a
// cluster's prominence — a vivid graphic color should outrank a similarly
// sized but muted/shaded cluster, matching how a human eye reads "the" color
// of a busy print.
function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  const min = Math.min(r, g, b);
  return (max - min) / max;
}

// Pixels within this RGB distance of a sampled corner color are excluded as
// backdrop. Tight on purpose — it should only catch the backdrop's own color
// (and its natural noise/gradient), not a garment whose color merely happens
// to be similar.
const CORNER_EXCLUDE_THRESHOLD = 15;

// Corners are sampled as small averaged patches to smooth out noise.
const CORNER_PATCH = 4;

const CLUSTERS = 5;
const MAX_ITERATIONS = 10;

// If the top two clusters' colors are within this Lab distance (delta-E) of
// each other, they're treated as the same color seen under different
// lighting/shading (e.g. a shadowed fold vs. the lit fabric on a solid-color
// garment) rather than a deliberate second color — secondary is reported as
// null instead of a near-duplicate of primary.
// Set to 25 (up from 18) — studio-lit solid garments produce shading clusters
// scoring 18-24 deltaE that are NOT real design secondaries; only distinct
// design elements (stripes, logos, contrast panels) typically exceed 25.
const SECONDARY_MIN_DELTA_E = 25;

function averageColor(pixels: RGB[], indices: number[]): RGB {
  let r = 0, g = 0, b = 0;
  for (const i of indices) {
    r += pixels[i][0];
    g += pixels[i][1];
    b += pixels[i][2];
  }
  const n = indices.length;
  return [r / n, g / n, b / n];
}

function cornerPatchIndices(width: number, height: number, fromRight: boolean, fromBottom: boolean, size: number): number[] {
  const indices: number[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = fromRight ? width - 1 - dx : dx;
      const y = fromBottom ? height - 1 - dy : dy;
      indices.push(y * width + x);
    }
  }
  return indices;
}

// k-means++-style init: repeatedly pick the pixel farthest from the
// centroids chosen so far, so initial centroids are spread across the color
// space instead of clustering around one dominant shade.
function initCentroids(pixels: RGB[], k: number): RGB[] {
  const centroids: RGB[] = [pixels[0]];
  while (centroids.length < k) {
    let best = pixels[0];
    let bestDist = -1;
    for (const p of pixels) {
      let minDist = Infinity;
      for (const c of centroids) {
        const d = distSq(p, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        best = p;
      }
    }
    centroids.push(best);
  }
  return centroids;
}

// Groups pixels into `k` clusters by color similarity (Lloyd's algorithm),
// returning each cluster's average color and pixel count.
function kMeans(pixels: RGB[], k: number): { color: RGB; count: number }[] {
  let centroids = initCentroids(pixels, k);
  const assignments: number[] = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(pixels[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
    }

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      sums[c][3] += 1;
    }

    centroids = centroids.map((centroid, c) =>
      sums[c][3] > 0
        ? ([sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]] as RGB)
        : centroid
    );

    if (!changed) break;
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a]++;

  return centroids.map((color, i) => ({ color, count: counts[i] }));
}

// Downloads the product image and extracts its two most prominent colors.
//
// Backdrop detection samples the 4 corners of the image — virtually always
// pure backdrop, since products are photographed roughly centered — and
// excludes pixels close to any of those corner colors. The threshold is
// deliberately tight: a backdrop and a similarly-light garment can be close
// enough to form one connected region by color, but still different enough
// for k-means to tell apart, so a tight exclusion removes the backdrop's
// specific shade without removing the garment's.
//
// The image is resized with nearest-neighbor sampling rather than the
// smoother default (Lanczos) — smoothing blends adjacent pixels together,
// which on a thin alternating pattern (e.g. stripes) averages two real
// colors into a blended color that doesn't exist on the garment at all.
// Nearest-neighbor only ever copies real source pixels, so cluster colors
// stay true to the actual fabric.
//
// The remaining pixels are grouped into a handful of color clusters
// (k-means) before being mapped to named colors, so a logo's anti-aliased
// edge pixels — which blend toward neighboring colors across a gradient —
// get averaged back into the cluster's true color instead of scattering
// across several adjacent names. Clusters are then ranked by count weighted
// by saturation, so a vivid graphic color outranks a similarly sized but
// muted/shaded cluster — matching how a human eye picks out "the" color of a
// busy print.
//
// Finally, if the top two clusters are perceptually almost the same color
// (small Lab distance — typically a shadowed fold vs. the lit fabric on a
// single-color garment), secondary is reported as null rather than a
// near-duplicate of primary.
export async function extractColors(imageUrl: string): Promise<ColorResult> {
  try {
    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Keep alpha channel so we can detect transparent-background PNGs (background-removed images).
    // For those, we filter by alpha >= 128 instead of using corner-based exclusion.
    const { data: rawData, info: rawInfo } = await sharp(buffer)
      .resize(RESIZE, RESIZE, { fit: "cover", kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hasTransparency = rawInfo.channels === 4 &&
      (() => {
        let transparentCount = 0;
        for (let i = 3; i < rawData.length; i += 4) {
          if (rawData[i] < 128) transparentCount++;
        }
        return transparentCount / (rawData.length / 4) > 0.1;
      })();

    let pixels: RGB[];

    if (hasTransparency) {
      // Background-removed image: filter out transparent pixels (alpha < 128).
      // No corner exclusion needed — the background is already gone.
      pixels = [];
      for (let i = 0; i < rawData.length; i += 4) {
        if (rawData[i + 3] >= 128) {
          pixels.push([rawData[i], rawData[i + 1], rawData[i + 2]]);
        }
      }
    } else {
      // Opaque image: use corner-based background exclusion as before.
      const allPixels: RGB[] = [];
      for (let i = 0; i < rawInfo.width * rawInfo.height; i++) {
        const idx = i * 4;
        allPixels.push([rawData[idx], rawData[idx + 1], rawData[idx + 2]]);
      }
      const corners = [
        averageColor(allPixels, cornerPatchIndices(rawInfo.width, rawInfo.height, false, false, CORNER_PATCH)),
        averageColor(allPixels, cornerPatchIndices(rawInfo.width, rawInfo.height, true,  false, CORNER_PATCH)),
        averageColor(allPixels, cornerPatchIndices(rawInfo.width, rawInfo.height, false, true,  CORNER_PATCH)),
        averageColor(allPixels, cornerPatchIndices(rawInfo.width, rawInfo.height, true,  true,  CORNER_PATCH)),
      ];
      const thresholdSq = CORNER_EXCLUDE_THRESHOLD ** 2;
      pixels = allPixels.filter((p) => !corners.some((c) => distSq(p, c) <= thresholdSq));
    }

    if (pixels.length === 0) {
      return { primary: null, primaryRgb: null, secondary: null, secondaryRgb: null, colors: [] };
    }

    const clusters = kMeans(pixels, Math.min(CLUSTERS, pixels.length));

    const clusterInfo = clusters
      .filter((c) => c.count > 0)
      .map((c) => ({
        rgb: c.color.map((v) => Math.round(v)) as RGB,
        count: c.count,
        name: nearestColorName(...c.color),
        weight: c.count * (1 + saturation(c.color)),
      }));

    console.log("[colorExtraction] clusters:", clusterInfo);

    const weights: Record<string, number> = {};
    const repColor: Record<string, RGB> = {};
    const repWeight: Record<string, number> = {};
    for (const c of clusterInfo) {
      weights[c.name] = (weights[c.name] || 0) + c.weight;
      if (!(c.name in repWeight) || c.weight > repWeight[c.name]) {
        repWeight[c.name] = c.weight;
        repColor[c.name] = c.rgb;
      }
    }

    const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0]?.[0] ?? null;
    const secondaryCandidate = sorted[1]?.[0] ?? null;
    let secondary: string | null = secondaryCandidate;

    if (primary !== null && secondaryCandidate !== null) {
      const deltaE = Math.sqrt(labDistSq(
        rgbToLab(...repColor[primary]),
        rgbToLab(...repColor[secondaryCandidate])
      ));
      console.log(`[colorExtraction] primary=${primary} secondary=${secondaryCandidate} deltaE=${deltaE.toFixed(1)}`);
      if (deltaE < SECONDARY_MIN_DELTA_E) {
        secondary = null;
      }
    }

    // Build ranked color list — collapse near-duplicates (deltaE < 18) so a
    // shadowed fold of the same color doesn't count as a distinct color.
    const allColors: string[] = [];
    for (const [name] of sorted) {
      if (allColors.length === 0) {
        allColors.push(name);
        continue;
      }
      const rgb = repColor[name];
      const tooClose = allColors.some(existing => {
        const dE = Math.sqrt(labDistSq(rgbToLab(...repColor[existing]), rgbToLab(...rgb)));
        return dE < 18;
      });
      if (!tooClose) allColors.push(name);
      if (allColors.length >= 5) break;
    }

    return {
      primary,
      primaryRgb: primary ? (repColor[primary] ?? null) : null,
      secondary,
      secondaryRgb: secondary ? (repColor[secondary] ?? null) : null,
      colors: allColors,
    };
  } catch {
    return { primary: null, primaryRgb: null, secondary: null, secondaryRgb: null, colors: [] };
  }
}

