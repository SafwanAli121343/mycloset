// Splits grid images into individual clothing pieces with backgrounds removed.
// First run downloads the AI model (~100MB) — subsequent runs are fast.
//
// Place source files:
//   public/scatter/raw/grid1.png  — 4 cols × 5 rows
//   public/scatter/raw/grid2.png  — 7 cols × 6 rows
//
// Run: node scripts/splitImages.mjs

import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";

const GRIDS = [
  { file: "public/scatter/raw/grid1.png", cols: 4, rows: 5 },
  { file: "public/scatter/raw/grid2.png", cols: 7, rows: 6 },
];

const OUT_DIR = "public/scatter";
const TMP_DIR = path.join(os.tmpdir(), "mycloset-scatter");
const BUFFER = 8; // extra px around each detected content region (captures edge pixels)
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Detect content strip boundaries along one axis using brightness gap detection.
// Returns array of { start, end } objects for each content region (between high-brightness gaps).
async function detectBoundaries(file, axis) {
  const { data, info } = await sharp(file)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const len = axis === "y" ? height : width;
  const crossLen = axis === "y" ? width : height;

  const lineAvg = [];
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let j = 0; j < crossLen; j++) {
      const off =
        axis === "y"
          ? (i * width + j) * channels
          : (j * width + i) * channels;
      sum += (data[off] + data[off + 1] + data[off + 2]) / 3;
    }
    lineAvg.push(sum / crossLen);
  }

  // Find clusters of high-brightness lines (gaps / whitespace between items)
  const GAP_THRESHOLD = 230;
  const gaps = [];
  let inGap = false;
  let gapStart = 0;
  lineAvg.forEach((b, i) => {
    if (b > GAP_THRESHOLD && !inGap) { inGap = true; gapStart = i; }
    else if (b <= GAP_THRESHOLD && inGap) { inGap = false; gaps.push([gapStart, i - 1]); }
  });
  if (inGap) gaps.push([gapStart, len - 1]);

  // Content regions sit between consecutive gaps
  const regions = [];
  for (let i = 0; i < gaps.length - 1; i++) {
    regions.push({ start: gaps[i][1] + 1, end: gaps[i + 1][0] - 1 });
  }
  return { regions, imageLen: len };
}

// Fall back to uniform division if auto-detection finds the wrong count.
function uniformRegions(len, count) {
  const size = Math.floor(len / count);
  return Array.from({ length: count }, (_, i) => ({
    start: i * size,
    end: i === count - 1 ? len - 1 : (i + 1) * size - 1,
  }));
}

let index = 1;

for (const { file, cols, rows } of GRIDS) {
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file} — not found`);
    index += cols * rows; // keep piece numbers aligned
    continue;
  }

  const meta = await sharp(file).metadata();
  console.log(`\n${file}: ${meta.width}×${meta.height}`);

  let rowRegions, colRegions;

  try {
    const rd = await detectBoundaries(file, "y");
    rowRegions =
      rd.regions.length === rows ? rd.regions : uniformRegions(meta.height, rows);

    const cd = await detectBoundaries(file, "x");
    colRegions =
      cd.regions.length === cols ? cd.regions : uniformRegions(meta.width, cols);
  } catch {
    rowRegions = uniformRegions(meta.height, rows);
    colRegions = uniformRegions(meta.width, cols);
  }

  if (rowRegions.length !== rows || colRegions.length !== cols) {
    console.log(`  Auto-detect mismatch — using uniform division`);
    rowRegions = uniformRegions(meta.height, rows);
    colRegions = uniformRegions(meta.width, cols);
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tmpFile = path.join(TMP_DIR, `tmp_${index}.png`);
      const outFile = path.join(OUT_DIR, `piece${index}.png`);

      // Extract with buffer around detected content region so edge pixels aren't clipped
      const left = Math.max(0, colRegions[col].start - BUFFER);
      const top = Math.max(0, rowRegions[row].start - BUFFER);
      const right = Math.min(meta.width - 1, colRegions[col].end + BUFFER);
      const bottom = Math.min(meta.height - 1, rowRegions[row].end + BUFFER);
      const w = right - left + 1;
      const h = bottom - top + 1;

      await sharp(file)
        .extract({ left, top, width: w, height: h })
        .png()
        .toFile(tmpFile);

      try {
        const blob = await removeBackground(tmpFile);
        const buffer = Buffer.from(await blob.arrayBuffer());
        fs.writeFileSync(outFile, buffer);
        console.log(`  ✓ piece${index}.png  (r${row}c${col} ${left},${top} ${w}×${h})`);
      } catch (err) {
        fs.copyFileSync(tmpFile, outFile);
        console.log(`  ⚠ piece${index}.png (no bg removal: ${err.message})`);
      }

      index++;
    }
  }
}

console.log(`\nDone — ${index - 1} pieces written to ${OUT_DIR}/`);
