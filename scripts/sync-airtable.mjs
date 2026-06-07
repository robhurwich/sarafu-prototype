// @ts-nocheck
// Manual Airtable → mock-data sync.
//
//   pnpm sync:airtable
//
// Reads the single Airtable table (Thing Type = "Farmer's Market" | "Vendor"),
// transforms the Easthampton vendors into Community Asset Voucher objects, geocodes
// their addresses, and writes src/mock/airtable.generated.ts. data.ts imports that
// file for the Easthampton (EFM) pool. Northampton/Amherst stay fully mock.
//
// Credentials come from .env.local: AIRTABLE_PAT and AIRTABLE_BASE_ID (the base
// URL is fine — the app/table ids are parsed out of it).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── env ──────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const txt = readFileSync(join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnvLocal();
const PAT = env.AIRTABLE_PAT;
const RAW_BASE = env.AIRTABLE_BASE_ID ?? "";
const baseId = (RAW_BASE.match(/app[A-Za-z0-9]+/) ?? [])[0];
const tableId = (RAW_BASE.match(/tbl[A-Za-z0-9]+/) ?? [])[0] ?? "Thing"; // fall back to table name
if (!PAT || !baseId) {
  console.error("Missing AIRTABLE_PAT or a valid base id in .env.local");
  process.exit(1);
}

// ── persona owners (stable mock addresses; keep demo logins owning real shops) ──
const PERSONA = {
  alice: "0xaa000000000000000000000000000000aa000001",
  bob: "0xbb000000000000000000000000000000bb000001",
  carol: "0xcc000000000000000000000000000000cc000001",
  dave: "0xdd000000000000000000000000000000dd000001",
  emma: "0xee000000000000000000000000000000ee000001",
};
// Easthampton market centroid (geo is {x: lat, y: lng} per app convention)
const EFM_GEO = { x: 42.2676, y: -72.6687 };

// ── helpers ────────────────────────────────────────────────────────────────
const TARGET_MARKET = "Easthampton Farmers Market";

function genAddress(recordId) {
  const hex = createHash("sha1").update(recordId).digest("hex").slice(0, 40);
  return `0x${hex}`;
}
function genOwnerAddress(recordId) {
  const hex = createHash("sha1").update(`${recordId}:owner`).digest("hex").slice(0, 40);
  return `0x${hex}`;
}

const usedSymbols = new Set();
function genSymbol(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/);
  let base =
    words.length > 1
      ? words.map((w) => w[0]).join("").toUpperCase().slice(0, 5)
      : (words[0] ?? "VCHR").toUpperCase().slice(0, 5);
  let sym = base || "VCHR";
  let n = 2;
  while (usedSymbols.has(sym)) sym = `${base}${n++}`;
  usedSymbols.add(sym);
  return sym;
}

function firstUrl(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.startsWith("http")) return v;
    if (Array.isArray(v) && v[0]?.url) return v[0].url;
  }
  return null;
}

async function geocode(address) {
  if (!address || /p\.?o\.? box/i.test(address)) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "sarafu-prototype-sync/1.0 (rob@hscooperative.com)" },
    });
    const j = await r.json();
    if (Array.isArray(j) && j[0]) {
      return { x: Number(j[0].lat), y: Number(j[0].lon) }; // x=lat, y=lng
    }
  } catch (e) {
    console.warn("  geocode failed for", address, String(e));
  }
  return null;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// jitter a point deterministically so co-located pins don't overlap
function jitter(base, seedStr) {
  const h = parseInt(createHash("sha1").update(seedStr).digest("hex").slice(0, 8), 16);
  const dx = ((h % 1000) / 1000 - 0.5) * 0.012;
  const dy = (((h >> 10) % 1000) / 1000 - 0.5) * 0.012;
  return { x: +(base.x + dx).toFixed(5), y: +(base.y + dy).toFixed(5) };
}

// ── offer generation ────────────────────────────────────────────────────
// Until offers come from Airtable, synthesise 2–3 plausible offers per vendor
// from their category/description. Rule order matters; all matches are pooled
// and capped at 3. Each entry: [name, description, price].
const OFFER_RULES = [
  [/soap|body|bath/, [
    ["Artisan Soap Bar", "Handmade cold-process soap bar", 8],
    ["Body Butter", "Whipped shea & cocoa body butter", 12],
    ["Incense Bundle", "Hand-rolled incense sticks", 6],
  ]],
  [/clean|home|space/, [
    ["All-Purpose Surface Spray", "Plant-based cleaning spray", 10],
    ["Room & Linen Mist", "Botanical room mist", 9],
  ]],
  [/cake|dessert|sweet/, [
    ["Layer Cake Slice", "Generous slice of the week's layer cake", 7],
    ["Cupcake 4-Pack", "Assorted from-scratch cupcakes", 12],
  ]],
  [/gumbo|cajun|creole/, [
    ["Chicken & Sausage Gumbo", "Hearty pint of classic gumbo", 14],
    ["Red Beans & Rice", "Slow-cooked red beans over rice", 10],
  ]],
  [/gluten\s*free/, [
    ["GF Sandwich Bread", "Soft gluten-free sandwich loaf", 9],
    ["GF Chocolate Chip Cookies", "Half-dozen gluten-free cookies", 8],
  ]],
  [/vegan|dairy\s*free/, [
    ["Vegan Brownie", "Fudgy dairy-free brownie", 5],
    ["Dairy-Free Muffin", "Seasonal vegan muffin", 4],
  ]],
  [/poultry|meat|pork|beef/, [
    ["Pasture Ground Beef", "Grass-fed ground beef (1 lb)", 11],
    ["Heritage Pork Chops", "Pasture-raised pork chops", 14],
    ["Whole Chicken", "Pasture-raised whole chicken", 20],
  ]],
  [/produce|vegetable|veg|garden|farm/, [
    ["Mixed Veggie Box", "Seasonal CSA-style vegetable box", 22],
    ["Salad Greens", "Washed mixed salad greens", 5],
    ["Seasonal Bunch", "This week's featured vegetable", 4],
  ]],
  [/egg/, [["Pasture-Raised Eggs", "One dozen pasture-raised eggs", 6]]],
  [/grocer|pantry|bulk/, [
    ["Pantry Staples Box", "Curated box of local pantry goods", 25],
    ["Bulk Refill Credit", "Refill credit toward bulk goods", 10],
  ]],
];

let offerId = 1000;
function generateOffers(v) {
  const hay = `${v.category ?? ""} ${v.voucher_description ?? ""}`.toLowerCase();
  const picked = [];
  for (const [re, offers] of OFFER_RULES) {
    if (re.test(hay)) picked.push(...offers);
    if (picked.length >= 3) break;
  }
  if (picked.length === 0) {
    picked.push([`${v.voucher_name} Shop Credit`, v.voucher_description || "Shop credit", 10]);
  }
  const seed = parseInt(v.voucher_address.slice(2, 8), 16);
  return picked.slice(0, 3).map(([nm, desc, price], i) => ({
    id: ++offerId,
    commodity_name: nm,
    commodity_description: desc,
    commodity_type: "GOOD",
    price,
    quantity: 15 + ((seed + i * 7) % 35),
    frequency: "weekly",
    image_url: v.banner_url ?? `https://picsum.photos/seed/${(seed + i) % 900}/400/300`,
    voucher_address: v.voucher_address,
    voucher_name: v.voucher_name,
    voucher_symbol: v.symbol,
    location_name: v.location_name,
    voucher_geo: v.geo,
  }));
}

// ── fetch all records ────────────────────────────────────────────────────
async function fetchAll() {
  const out = [];
  let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`);
    u.searchParams.set("pageSize", "100");
    if (offset) u.searchParams.set("offset", offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${PAT}` } });
    const j = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    out.push(...j.records);
    offset = j.offset;
  } while (offset);
  return out;
}

// ── main ───────────────────────────────────────────────────────────────────
const records = await fetchAll();
const F = (r) => r.fields ?? {};
const name = (r) => F(r)["Vendor/Market/Contact Name"] ?? "Unknown";

const markets = new Map(); // id -> name
for (const r of records) {
  if (F(r)["Thing Type"] === "Farmer's Market") markets.set(r.id, name(r));
}
const efmId = [...markets.entries()].find(([, n]) => n === TARGET_MARKET)?.[0];

const vendors = records.filter((r) => {
  if (F(r)["Thing Type"] !== "Vendor") return false;
  const m = F(r)["Market(s)"];
  return Array.isArray(m) && efmId ? m.includes(efmId) : false;
});

console.log(`Found ${vendors.length} vendors at ${TARGET_MARKET}`);

// Persona ownership: Dave's farm → dave; then alice/bob/carol to next three.
const personaQueue = ["alice", "bob", "carol"];
/** @param {string} vendorName @param {string} recordId */
function assignOwner(vendorName, recordId) {
  if (/dave/i.test(vendorName)) return { addr: PERSONA.dave, persona: "dave" };
  const p = personaQueue.shift();
  const personas = /** @type {Record<string, string>} */ (PERSONA);
  if (p) return { addr: personas[p], persona: p };
  return { addr: genOwnerAddress(recordId), persona: null };
}

const vouchers = [];
for (const r of vendors) {
  const f = F(r);
  const vName = name(r);
  const address = genAddress(r.id);
  const symbol = genSymbol(vName);
  const locationText = f["Location"] ?? TARGET_MARKET + ", MA";

  let geo = await geocode(f["Location"]);
  if (geo) await sleep(1100); // Nominatim courtesy rate limit
  if (!geo) geo = jitter(EFM_GEO, r.id);

  const owner = assignOwner(vName, r.id);
  const banner = firstUrl(f["Image URL"], f["2nd Image URL"], f["Image File"]);
  const icon = firstUrl(f["Image File"], f["Image URL"], f["2nd Image URL"]);

  vouchers.push({
    voucher_address: address,
    symbol,
    voucher_name: vName,
    voucher_description: f["Description"] ?? "",
    voucher_type: "GIFTABLE",
    voucher_uoa: f["Unit of Account"] ?? "USD",
    voucher_value: 1,
    location_name: locationText,
    geo,
    voucher_email: f["Email"] ?? null,
    voucher_website: f["Website"] ?? null,
    banner_url: banner,
    icon_url: icon,
    redemption_address: owner.addr,
    owner_name: f["Owners"] ?? null,
    owner_persona: owner.persona,
    category: f["Type"] ?? null,
    created_at: f["Created"] ?? "2026-06-01",
    transaction_count: 50 + (parseInt(address.slice(2, 6), 16) % 350),
    internal: false,
    contract_version: "1.0",
    airtable_id: r.id,
  });
  console.log(
    `  • ${vName} [${symbol}] owner=${owner.persona ?? "generated"} geo=${geo.x.toFixed(3)},${geo.y.toFixed(3)}`
  );
}

const offers = vouchers.flatMap((v) => generateOffers(v));
console.log(`Generated ${offers.length} offers across ${vouchers.length} vendors`);

// ── write generated file ───────────────────────────────────────────────────
const header = `// AUTO-GENERATED by scripts/sync-airtable.mjs — do not edit by hand.
// Source: Airtable base ${baseId}. Re-run: pnpm sync:airtable
// Generated: ${new Date().toISOString()}
/* eslint-disable */

export type GeneratedVoucher = {
  voucher_address: \`0x\${string}\`;
  symbol: string;
  voucher_name: string;
  voucher_description: string;
  voucher_type: "GIFTABLE";
  voucher_uoa: string;
  voucher_value: number;
  location_name: string;
  geo: { x: number; y: number };
  voucher_email: string | null;
  voucher_website: string | null;
  banner_url: string | null;
  icon_url: string | null;
  redemption_address: \`0x\${string}\`;
  owner_name: string | null;
  owner_persona: string | null;
  category: string | null;
  created_at: string;
  transaction_count: number;
  internal: boolean;
  contract_version: string;
  airtable_id: string;
};

export const AIRTABLE_EFM_VOUCHERS: GeneratedVoucher[] = ${JSON.stringify(
  vouchers,
  null,
  2
)} as GeneratedVoucher[];

export type GeneratedOffer = {
  id: number;
  commodity_name: string;
  commodity_description: string;
  commodity_type: "GOOD";
  price: number;
  quantity: number;
  frequency: string;
  image_url: string;
  voucher_address: \`0x\${string}\`;
  voucher_name: string;
  voucher_symbol: string;
  location_name: string;
  voucher_geo: { x: number; y: number };
};

export const AIRTABLE_EFM_OFFERS: GeneratedOffer[] = ${JSON.stringify(
  offers,
  null,
  2
)} as GeneratedOffer[];
`;

const outPath = join(ROOT, "src", "mock", "airtable.generated.ts");
writeFileSync(outPath, header);
console.log(`\nWrote ${vouchers.length} vouchers → src/mock/airtable.generated.ts`);
