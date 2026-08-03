/**
 * Product refresh — run periodically (or on demand) to:
 *   1. Re-scrape all sources → adds new items, updates prices
 *   2. Check every product URL that's stale → removes dead links
 *
 * Usage:
 *   node scripts/refresh-products.mjs            # full refresh (scrape + check)
 *   node scripts/refresh-products.mjs --check    # link-check only (no re-scrape)
 *   node scripts/refresh-products.mjs --scrape   # re-scrape only (no link-check)
 *   node scripts/refresh-products.mjs stussy     # one brand only
 *
 * Soft-delete flow:
 *   • URL returns 404/410/redirected-off-product  → in_stock = false, check_failures++
 *   • URL returns 200 on correct page             → last_checked_at = now, check_failures = 0
 *   • Network error / timeout                     → skip (try again next cycle)
 *   • check_failures >= 3                         → hard DELETE (confirmed dead)
 *
 * Recommended schedule: weekly (Vercel cron or crontab)
 */

import { readFileSync }  from "fs";
import { createClient }  from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load env ──────────────────────────────────────────────────────────────────
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx < 0) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* env already set */ }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Config ────────────────────────────────────────────────────────────────────
const STALE_DAYS      = 14;   // re-check URLs not seen in this many days
const CONCURRENCY     = 8;    // parallel URL checks
const CHECK_TIMEOUT   = 10_000;
const FAILURE_LIMIT   = 3;    // hard delete after this many consecutive failures
const CHECK_DELAY_MS  = 150;  // ms between concurrent batches (polite)

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const doCheck  = !args.includes("--scrape"); // default on
const doScrape = !args.includes("--check");  // default on
const brandArg = args.find(a => !a.startsWith("--"))?.toLowerCase();

// ── URL liveness check ────────────────────────────────────────────────────────

/**
 * Returns:
 *   "alive"   — 200 and still on a product page
 *   "dead"    — 404 / 410 / redirected to non-product page
 *   "unknown" — timeout / network error / ambiguous (don't touch)
 */
async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MyCloset/1.0)" },
    });

    if (res.status === 404 || res.status === 410 || res.status === 301) return "dead";
    if (res.status >= 500) return "unknown"; // server error, try later
    if (res.status !== 200) return "unknown";

    // 200 but redirected? Make sure we're still on a product page.
    const finalUrl = res.url ?? url;
    const originalIsProduct = url.includes("/products/") || url.includes("/p/") || url.includes("/item/");
    const finalIsProduct    = finalUrl.includes("/products/") || finalUrl.includes("/p/") || finalUrl.includes("/item/");

    if (originalIsProduct && !finalIsProduct) {
      // Shopify-style redirect: removed product → collection page → looks like 200 but it's gone
      return "dead";
    }

    return "alive";
  } catch {
    return "unknown"; // timeout or network problem
  }
}

// ── Concurrent batch checker ──────────────────────────────────────────────────
async function checkBatch(items) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const statuses = await Promise.all(chunk.map(it => checkUrl(it.product_url)));
    for (let j = 0; j < chunk.length; j++) {
      results.push({ item: chunk[j], status: statuses[j] });
    }
    await delay(CHECK_DELAY_MS);
  }
  return results;
}

// ── Link verification pass ────────────────────────────────────────────────────
async function runLinkCheck() {
  console.log("\n── LINK CHECK ──────────────────────────────────");

  // Fetch items that are stale (never checked, or last checked > STALE_DAYS ago)
  const staleAfter = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
  const { data: stale, error } = await supabase
    .from("streetwear_products")
    .select("id, product_url, check_failures, brand")
    .or(`last_checked_at.is.null,last_checked_at.lt.${staleAfter}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(2000); // cap per run

  if (error) { console.error("Fetch error:", error.message); return; }
  const items = (stale ?? []).filter(it => brandArg ? it.brand.toLowerCase().includes(brandArg) : true);
  console.log(`Checking ${items.length} stale URL(s)...`);
  if (!items.length) { console.log("Nothing to check."); return; }

  const results = await checkBatch(items);

  let alive = 0, dead = 0, hardDeleted = 0, unknown = 0;
  const now = new Date().toISOString();

  for (const { item, status } of results) {
    if (status === "alive") {
      await supabase.from("streetwear_products").update({
        last_checked_at: now,
        check_failures: 0,
        in_stock: true,
      }).eq("id", item.id);
      alive++;
    } else if (status === "dead") {
      const failures = (item.check_failures ?? 0) + 1;
      if (failures >= FAILURE_LIMIT) {
        // Confirmed dead — hard delete
        await supabase.from("streetwear_products").delete().eq("id", item.id);
        process.stdout.write(`✗ DELETED ${item.brand}: ${item.product_url.slice(0, 60)}\n`);
        hardDeleted++;
      } else {
        // Soft mark — give it a few more cycles
        await supabase.from("streetwear_products").update({
          in_stock: false,
          check_failures: failures,
          last_checked_at: now,
        }).eq("id", item.id);
        dead++;
      }
    } else {
      // unknown — update timestamp so we don't re-check immediately, but don't remove
      await supabase.from("streetwear_products").update({ last_checked_at: now }).eq("id", item.id);
      unknown++;
    }
  }

  console.log(`Results: ${alive} alive  |  ${dead} soft-dead  |  ${hardDeleted} hard-deleted  |  ${unknown} skipped`);
}

// ── Re-scrape pass (adds new items + updates prices) ─────────────────────────
async function runScrape() {
  console.log("\n── RE-SCRAPE ────────────────────────────────────");

  // Dynamically import the scraper logic
  // Instead of duplicating scraper code, we call the scrape script as a subprocess
  const { execSync } = await import("child_process");
  const cmd = brandArg
    ? `node scripts/scrape-products.mjs ${brandArg}`
    : "node scripts/scrape-products.mjs";
  try {
    execSync(cmd, { stdio: "inherit", cwd: join(__dir, "..") });
  } catch (e) {
    console.error("Scrape subprocess failed:", e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\nProduct Refresh — ${new Date().toLocaleString()}`);
console.log(`Mode: ${doScrape ? "SCRAPE" : ""}${doScrape && doCheck ? " + " : ""}${doCheck ? "LINK CHECK" : ""}`);
if (brandArg) console.log(`Brand filter: ${brandArg}`);

if (doScrape) await runScrape();
if (doCheck)  await runLinkCheck();

// Final stats
const { data: stats } = await supabase
  .from("streetwear_products")
  .select("brand, in_stock");

const total   = stats?.length ?? 0;
const inStock = stats?.filter(r => r.in_stock !== false).length ?? 0;
const dead    = total - inStock;

console.log(`\n── Summary ──────────────────────────────────────`);
console.log(`Total in DB: ${total}  |  In stock: ${inStock}  |  Flagged dead: ${dead}`);
