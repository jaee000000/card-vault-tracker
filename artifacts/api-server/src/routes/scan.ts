import { Router } from "express";
import OpenAI from "openai";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

// Japanese set ID → nearest English set ID in PokéTCG
const JP_TO_EN: Record<string, string> = {
  "m2a": "sv2",   // Japanese "Mega Dream" / Ascended Heroes (198/193) → English Paldea Evolved (193)
  "m4":  "swsh11", // Japanese "Ninja Spinner" (83 cards) → English Lost Origin (approx era match)
  "sv1a": "sv1",  "sv1s": "sv1",  "sv1v": "sv1",
  "sv2a": "sv2",  "sv2d": "sv2",
  "sv3a": "sv3",  "sv3pt5a": "sv3pt5",
  "sv4a": "sv4",  "sv4k": "sv4",
  "sv5a": "sv5",  "sv5k": "sv5",  "sv5m": "sv5",
  "sv6a": "sv6",  "sv7a": "sv7",  "sv8a": "sv8",
  "s12a": "swsh12", "s11a": "swsh11", "s10a": "swsh10",
  "s9a": "swsh9",  "s8a": "swsh8",  "s7d": "swsh7",
  "s6a": "swsh6",  "s5a": "swsh5",  "s4a": "swsh4",
  "s3a": "swsh3",  "s2a": "swsh2",
};

// Japanese set ID → PriceCharting console name keyword (for better search precision)
const JP_SET_TO_PC: Record<string, string> = {
  "m2a": "mega dream",
  "m2b": "mega dream",
  "m4":  "ninja spinner",
  "sv1a": "triplet beat",
  "sv2a": "clay burst",
  "sv2b": "snow hazard",
  "sv2c": "thunder clap",
  "sv2d": "ancient roar",
  "sv3a": "scarlet ex",
  "sv4a": "future flash",
  "sv5a": "wild force",
  "sv5k": "crimson haze",
  "sv5m": "night wanderer",
  "sv6a": "transformation mask",
  "sv7a": "stellar miracle",
  "sv8a": "super electric breaker",
  "s12a": "vstar universe",
  "s11a": "lost abyss",
  "s10a": "dark phantasma",
};

function isJapaneseSet(id: string): boolean {
  const low = id.toLowerCase();
  return low in JP_TO_EN || /^(sv\d+[a-z]|s\d+[a-z]|m\d+[a-z]?)/i.test(low);
}

// Common Japanese romaji → official English species names. The AI is told to
// translate, but occasionally returns romaji (e.g. "Kairyu" instead of
// "Dragonite"), which breaks PriceCharting/PokéTCG lookups. This is a safety net.
const ROMAJI_TO_EN: Record<string, string> = {
  kairyu: "Dragonite", hakuryu: "Dragonair", miniryu: "Dratini",
  lizardon: "Charizard", lizardo: "Charmeleon", hitokage: "Charmander",
  kamex: "Blastoise", kameil: "Wartortle", zenigame: "Squirtle",
  fushigibana: "Venusaur", fushigisou: "Ivysaur", fushigidane: "Bulbasaur",
  gangar: "Gengar", ghos: "Gastly", ghost: "Haunter",
  yukimenoko: "Froslass", yukinoo: "Abomasnow",
  gaburias: "Garchomp", bangiras: "Tyranitar", bohmander: "Salamence",
  gekkouga: "Greninja", kabigon: "Snorlax",
  gardie: "Growlithe", windie: "Arcanine",
  eievui: "Eevee", booster: "Flareon", thunders: "Jolteon", showers: "Vaporeon",
  eifie: "Espeon", blacky: "Umbreon", leafia: "Leafeon", glacia: "Glaceon",
  nymphia: "Sylveon", houou: "Ho-Oh", sandaa: "Zapdos", fire: "Moltres",
  freezer: "Articuno", gyarados: "Gyarados", lucario: "Lucario",
  doraparuto: "Dragapult", mimikkyu: "Mimikyu", sarnori: "Rillaboom",
};

/** Replace any romaji species tokens with their English names (keeps Mega/ex/etc). */
function normalizeSpeciesName(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => {
      const key = word.toLowerCase().replace(/[^a-z]/g, "");
      return ROMAJI_TO_EN[key] ?? word;
    })
    .join(" ")
    .trim();
}

/** True if the Pokémon species in both names is the same (ignores prefixes like "Team Magma's") */
function namesMatch(aiName: string, cardName: string): boolean {
  if (!aiName || !cardName) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(aiName), b = norm(cardName);
  return a === b || a.includes(b) || b.includes(a);
}

type TCGCard = {
  name?: string;
  number?: string;
  set?: { id?: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, { market?: number; mid?: number }> };
  cardmarket?: { prices?: { averageSellPrice?: number; trendPrice?: number } };
};

type PCProduct = {
  productName?: string;
  consoleName?: string;
  consoleUid?: string;
  price1?: string;
  price2?: string;
  price3?: string;
  imageUri?: string;
  id?: string;
};

function bestPrice(card: TCGCard): number {
  const t = card.tcgplayer?.prices;
  if (t) {
    const usd =
      t["holofoil"]?.market ?? t["holofoil"]?.mid ??
      t["normal"]?.market ?? t["normal"]?.mid ??
      t["reverseHolofoil"]?.market ??
      t["1stEditionHolofoil"]?.market ??
      Object.values(t)[0]?.market ?? Object.values(t)[0]?.mid;
    if (usd && usd > 0) return +(usd * USD_TO_GBP).toFixed(2);
  }
  const cm = card.cardmarket?.prices;
  if (cm) {
    const eur = cm.averageSellPrice ?? cm.trendPrice;
    if (eur && eur > 0) return +(eur * EUR_TO_GBP).toFixed(2);
  }
  return 0;
}

async function tcgFetch(q: string, pageSize = 250): Promise<TCGCard[]> {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}&select=tcgplayer,cardmarket,name,number,set,images`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json() as { data?: TCGCard[] };
    return j.data ?? [];
  } catch { return []; }
}

/** Search PriceCharting (no API token needed for search-products endpoint) */
export async function priceChartingLookup(
  name: string,
  setNumber: number,
  setId?: string
): Promise<{ priceGBP: number; psa10GBP: number | null; imageUrl: string | null } | null> {
  const pcKeyword = setId ? (JP_SET_TO_PC[setId.toLowerCase()] ?? "") : "";

  // Build queries from most to least specific
  const queries: string[] = [];
  if (pcKeyword) queries.push(`${name} ${setNumber} ${pcKeyword} japanese`);
  queries.push(`${name} ${setNumber} japanese`);
  queries.push(`${name} #${setNumber} japanese`);

  // Deduplicate
  const unique = [...new Set(queries)];

  for (const q of unique) {
    try {
      const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=prices`;
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) continue;

      const data = await r.json() as { products?: PCProduct[] };
      const products = data.products ?? [];
      if (!products.length) continue;

      const numStr = `#${setNumber}`;

      // Prefer Japanese set match with exact card number
      const japanese = products.filter(
        (p) =>
          p.productName?.toLowerCase().includes(name.toLowerCase()) &&
          p.productName?.includes(numStr) &&
          p.consoleName?.toLowerCase().includes("japanese")
      );
      // Fallback: any match with exact card number
      const any = products.filter(
        (p) =>
          p.productName?.toLowerCase().includes(name.toLowerCase()) &&
          p.productName?.includes(numStr)
      );

      const match = japanese[0] ?? any[0];
      if (!match) continue;

      return toPrice(match);
    } catch {
      continue;
    }
  }

  // ── Fallback: AI may have misread the number/set. Search by name only and
  //    pick the Japanese result with the closest card number. ────────────────
  const fallbackQueries = [...new Set([
    pcKeyword ? `${name} ${pcKeyword} japanese` : "",
    `${name} japanese`,
  ].filter(Boolean))];

  for (const q of fallbackQueries) {
    try {
      const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=prices`;
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) continue;

      const data = await r.json() as { products?: PCProduct[] };
      const japanese = (data.products ?? []).filter(
        (p) =>
          p.productName?.toLowerCase().includes(name.toLowerCase()) &&
          p.consoleName?.toLowerCase().includes("japanese")
      );
      if (!japanese.length) continue;

      // Pick the result whose printed number is closest to what the AI read
      const closest = japanese
        .map((p) => ({
          p,
          num: parseInt(p.productName?.match(/#(\d+)/)?.[1] ?? "99999", 10),
        }))
        .sort((a, b) => Math.abs(a.num - setNumber) - Math.abs(b.num - setNumber))[0];

      if (closest) return toPrice(closest.p);
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Best-effort image + price finder for backfilling existing saved cards.
 * Japanese sets → PriceCharting (exact card). Otherwise → PokéTCG by name,
 * preferring the result whose set total matches; falls back to any match.
 */
export async function findCardImage(
  name: string,
  setNumber: number,
  setTotal: number,
  setCode?: string
): Promise<{ imageUrl: string | null; priceGBP: number }> {
  const jpSet = setCode ? isJapaneseSet(setCode) : false;

  if (jpSet) {
    const pc = await priceChartingLookup(name, setNumber, setCode);
    if (pc && pc.imageUrl) return { imageUrl: pc.imageUrl, priceGBP: pc.priceGBP };
  }

  // PokéTCG: find a real card of this Pokémon, preferring matching set total.
  // Quoted multi-word names (e.g. "Mewtwo VMAX") can return nothing, so fall
  // back to a wildcard search on the first word.
  const searchName = name.replace(/^mega\s+/i, "").trim();
  const firstWord = searchName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");
  let byName = await tcgFetch(`name:"${searchName}"`, 50);
  if (!byName.length && firstWord.length > 2) {
    byName = await tcgFetch(`name:${firstWord}*`, 150);
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(name);
  // Prefer the exact same variant (e.g. "Mewtwo VMAX"), then any name match
  const exactVariant = byName.filter((c) => norm(c.name ?? "") === target);
  const matched = exactVariant.length
    ? exactVariant
    : byName.filter((c) => namesMatch(name, c.name ?? ""));
  const pool = matched.length ? matched : byName;
  const best = pool.sort(
    (a, b) =>
      Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
      Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
  )[0];
  if (best && (best.images?.large || best.images?.small)) {
    return {
      imageUrl: best.images?.large ?? best.images?.small ?? null,
      priceGBP: bestPrice(best),
    };
  }

  // PriceCharting without the Japanese hint
  const pc = await priceChartingLookup(name, setNumber, setCode);
  if (pc && pc.imageUrl) return { imageUrl: pc.imageUrl, priceGBP: pc.priceGBP };

  // Last resort: live web search for official art (works from prod, where
  // PriceCharting is blocked). Validated to actually render before we accept it.
  const webImg = await webSearchOfficialImage(name, setNumber, setTotal, setCode);
  if (webImg) return { imageUrl: webImg, priceGBP: 0 };

  return { imageUrl: null, priceGBP: 0 };
}

/**
 * Convert a PriceCharting product to our price/image shape.
 * price1 = ungraded/raw, price2 = PSA 10, price3 = PSA 9.
 */
function toPrice(p: PCProduct): { priceGBP: number; psa10GBP: number | null; imageUrl: string | null } {
  const rawUSD = parseFloat((p.price1 ?? "").replace(/[^0-9.]/g, "")) || 0;
  const priceGBP = rawUSD > 0 ? +(rawUSD * USD_TO_GBP).toFixed(2) : 0;

  const psa10USD = parseFloat((p.price2 ?? "").replace(/[^0-9.]/g, "")) || 0;
  const psa10GBP = psa10USD > 0 ? +(psa10USD * USD_TO_GBP).toFixed(2) : null;

  const imgRaw = p.imageUri ?? null;
  const imageUrl = imgRaw && !imgRaw.includes("no-image-available") ? imgRaw : null;
  return { priceGBP, psa10GBP, imageUrl };
}

/**
 * Last-resort price: a live web search for the RAW (ungraded) market price.
 * Uses gpt-4o-search-preview, which reaches the open web even from the
 * production deployment — unlike PriceCharting, whose plain search endpoint
 * returns an empty body to our prod egress IP. Used for Japanese-only cards
 * that aren't in PokéTCG and can't reach PriceCharting in production.
 * Returns 0 when nothing reliable is found.
 */
export async function webSearchRawPriceGBP(
  name: string,
  setNumber: number,
  setTotal: number,
  setId?: string
): Promise<number> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return 0;
  const setName = setId ? JP_SET_TO_PC[setId.toLowerCase()] : undefined;
  const desc =
    `${name} ${setTotal > 0 ? `${setNumber}/${setTotal}` : `#${setNumber}`}` +
    (setId ? ` (set code ${setId.toUpperCase()}${setName ? `, "${setName}"` : ""})` : "");
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: "gpt-4o-search-preview",
        web_search_options: { search_context_size: "low" },
        messages: [
          {
            role: "user",
            content:
              `Find the current RAW (ungraded, Near Mint) market price in GBP for this${setId && isJapaneseSet(setId) ? " Japanese-language" : ""} Pokémon card: ${desc}. ` +
              `Search eBay UK and eBay.com SOLD/completed listings, PriceCharting, mavin.io, 130point, and TCG marketplaces for recent actual sold prices of the UNGRADED card (NOT graded / PSA / BGS / CGC). ` +
              `Convert USD to GBP (1 USD = ${USD_TO_GBP} GBP) and JPY to GBP (1 JPY = 0.0052 GBP). ` +
              `Use a typical recent sold price, not the highest outlier. ` +
              `Reply with ONLY a JSON object and nothing else: {"raw_gbp": <number, or null if you cannot find a real sold price>}`,
          },
        ],
      }),
    });
    if (!resp.ok) return 0;
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    // Robust extraction: pull the raw_gbp value directly (handles bare numbers,
    // quoted numbers, currency symbols, prose, and ```json fences alike).
    let v = 0;
    const direct = content.match(/"?raw_gbp"?\s*[:=]\s*"?\s*£?\s*([\d]+(?:\.[\d]+)?)/i);
    if (direct) {
      v = parseFloat(direct[1]);
    } else {
      // Fallback: try parsing the last JSON-looking object in the text.
      const objs = content.match(/\{[^{}]*\}/g);
      if (objs) {
        for (let i = objs.length - 1; i >= 0; i--) {
          try {
            const p = JSON.parse(objs[i]) as { raw_gbp?: unknown };
            const n = typeof p.raw_gbp === "string" ? parseFloat(p.raw_gbp) : p.raw_gbp;
            if (typeof n === "number" && isFinite(n) && n > 0) { v = n; break; }
          } catch { /* keep scanning */ }
        }
      }
    }
    if (!(v > 0) || !isFinite(v)) return 0;
    console.log(`[price] web-search: "${name}" £${v.toFixed(2)}`);
    return +v.toFixed(2);
  } catch (err) {
    console.warn("[price] web-search failed:", (err as Error).message);
    return 0;
  }
}

/**
 * Deterministic official artwork for Japanese cards via LimitlessTCG's JP card
 * database. Unlike the AI web search — which hallucinates plausible-but-404
 * image URLs (e.g. serebii.net/card/megadreamex/016.jpg) — LimitlessTCG exposes
 * a REAL card page at /cards/jp/{set}/{num} whose <meta og:image> points at a
 * hot-linkable CDN image. We upgrade the "_SM" thumbnail to the "_LG" large
 * variant and confirm it actually renders from this server. Returns null when
 * the card isn't found or the image can't be validated.
 */
export async function limitlessJpImageUrl(
  setId: string,
  setNumber: number
): Promise<string | null> {
  const set = setId.trim().toLowerCase();
  if (!set || !setNumber) return null;
  try {
    const page = await fetch(
      `https://limitlesstcg.com/cards/jp/${encodeURIComponent(set)}/${setNumber}`,
      { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!page.ok) return null;
    const html = await page.text();
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let url = og?.[1];
    if (!url) {
      const m = html.match(
        /https?:\/\/limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com\/[^\s"'<>)\]]+?\.(?:png|jpg|jpeg|webp)/i
      );
      url = m?.[0];
    }
    if (!url || !isAllowedImageHost(url)) return null;
    // Prefer the large variant; fall back to whatever og:image gave us.
    const large = url.replace(/_SM\.(png|jpe?g|webp)$/i, "_LG.$1");
    if (large !== url && (await validateImageUrl(large))) {
      console.log(`[image] limitless-jp: "${set} ${setNumber}" → ${large}`);
      return large;
    }
    if (await validateImageUrl(url)) {
      console.log(`[image] limitless-jp: "${set} ${setNumber}" → ${url}`);
      return url;
    }
    return null;
  } catch (err) {
    console.warn("[image] limitless-jp failed:", (err as Error).message);
    return null;
  }
}

/**
 * Trusted card-image hosts. Acts as both an SSRF guard (the URLs come from
 * untrusted AI output, so we only ever fetch known public card CDNs — never
 * arbitrary hosts, IP literals, or internal addresses) and a correctness guard
 * (these are reputable official/community card sources, not random listings).
 */
const IMAGE_HOST_ALLOWLIST = [
  "images.pokemontcg.io",
  "pokemontcg.io",
  "pokemon-card.com",
  "tcgplayer.com",
  "limitlesstcg.com",
  "limitlesstcg.nyc3.cdn.digitaloceanspaces.com",
  "serebii.net",
  "bulbagarden.net",
];

/** A URL is allowed only when its hostname is (or ends with) a trusted host. */
function isAllowedImageHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false; // no IP literals
    return IMAGE_HOST_ALLOWLIST.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

/**
 * Confirm a candidate image URL actually loads as an image FROM THIS SERVER.
 * Because this runs in production, a pass means the URL is reachable and
 * hot-linkable from the deployed environment (not 403/empty/HTML). We never
 * store a URL we can't prove renders, so cards never show a broken image.
 */
async function validateImageUrl(url: string): Promise<boolean> {
  if (!isAllowedImageHost(url)) return false;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
    });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return false;
    const len = Number(r.headers.get("content-length") ?? "0");
    if (len && len < 1000) return false; // tiny = tracking pixel / placeholder
    return true;
  } catch {
    return false;
  }
}

/**
 * Last-resort artwork: a live web search for a direct, official card-image URL.
 * Mirrors webSearchRawPriceGBP — uses gpt-4o-search-preview, which reaches the
 * open web from production where PriceCharting is blocked. Only returns a URL
 * that we have re-fetched and confirmed renders as a real image from prod, so a
 * Japanese-only card not in PokéTCG still shows official art instead of the
 * user's scan photo. Returns null when nothing reliable is found.
 */
export async function webSearchOfficialImage(
  name: string,
  setNumber: number,
  setTotal: number,
  setId?: string
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const setName = setId ? JP_SET_TO_PC[setId.toLowerCase()] : undefined;
  const desc =
    `${name} ${setTotal > 0 ? `${setNumber}/${setTotal}` : `#${setNumber}`}` +
    (setId ? ` (set code ${setId.toUpperCase()}${setName ? `, "${setName}"` : ""})` : "");
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: "gpt-4o-search-preview",
        web_search_options: { search_context_size: "low" },
        messages: [
          {
            role: "user",
            content:
              `Find direct image-file URLs of the OFFICIAL front artwork for this Pokémon card: ${desc}. ` +
              `Prefer hot-linkable, official/reliable sources whose URLs end in .jpg/.jpeg/.png/.webp: ` +
              `images.pokemontcg.io, the official Japanese site pokemon-card.com, tcgplayer product images, limitlesstcg.com, serebii.net, bulbapedia. ` +
              `The image must show ONLY this single card's front (not a graded slab, not a lot of multiple cards, not a back). ` +
              `Return up to 3 candidate URLs, best first. ` +
              `Reply with ONLY a JSON object and nothing else: {"image_urls": [<direct image url strings>]}`,
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    // Pull candidate URLs whether they arrive as a JSON array or loose in prose.
    const urls: string[] = [];
    const arr = content.match(/"image_urls"\s*:\s*\[([\s\S]*?)\]/i);
    const scope = arr ? arr[1] : content;
    const re = /https?:\/\/[^\s"'<>)\]]+?\.(?:jpg|jpeg|png|webp)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scope)) !== null) {
      if (!urls.includes(m[0]) && isAllowedImageHost(m[0])) urls.push(m[0]);
    }
    // Prefer URLs whose path references this card's number — a soft correctness
    // signal that the art is the right card, not just a renderable image.
    const numStr = String(setNumber);
    const numPad = numStr.padStart(3, "0");
    const ranked = urls.sort((a, b) => {
      const score = (u: string) =>
        new RegExp(`(^|[^0-9])(${numPad}|${numStr})([^0-9]|$)`).test(new URL(u).pathname) ? 0 : 1;
      return score(a) - score(b);
    });
    const candidates = ranked.slice(0, 3);
    // Validate in parallel (bounds tail latency), then take the first that
    // both renders AND, when any candidate references the number, matches it.
    const results = await Promise.all(candidates.map((u) => validateImageUrl(u)));
    for (let i = 0; i < candidates.length; i++) {
      if (results[i]) {
        console.log(`[image] web-search: "${name}" → ${candidates[i]}`);
        return candidates[i];
      }
    }
    return null;
  } catch (err) {
    console.warn("[image] web-search failed:", (err as Error).message);
    return null;
  }
}

async function lookupCard(
  name: string,
  setNumber: number,
  setTotal: number,
  setId?: string
): Promise<{ priceGBP: number; psa10GBP: number | null; imageUrl: string | null; priceNote: string | null }> {
  const numStr = String(setNumber).padStart(3, "0");
  const isSecret = setNumber > setTotal;
  const jpSet = setId ? isJapaneseSet(setId) : false;
  const enSetId = setId
    ? (JP_TO_EN[setId.toLowerCase()] ?? (!jpSet ? setId.toLowerCase() : null))
    : null;

  const baseName = name
    .replace(/^mega\s+/i, "")                                    // drop "Mega" prefix
    .replace(/[-\s]?(ex|GX|V|VMAX|VSTAR|AR|SAR|UR|SR|RR)$/i, "") // drop card-type suffix
    .trim();
  const firstName = baseName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");

  const jpNote = "Japanese card — price shown is for nearest English equivalent";

  // PRICE FIRST: for EVERY scanned card, kick off the live web-search price up
  // front so it runs concurrently with the image lookup below. The live web
  // price is the PRIMARY source — database prices (PokéTCG/PriceCharting) are
  // only used as a fallback when the live search comes back empty. This is what
  // the user asked for: the price should succeed on essentially every card
  // rather than failing to "Price N/A".
  const livePricePromise = webSearchRawPriceGBP(name, setNumber, setTotal, setId);

  // Cap how long the SCAN RESPONSE will wait on the live price. The web search
  // usually returns in ~2-4s but can take up to its 20s timeout; blocking the
  // whole /identify request that long risks the deployment/mobile gateway
  // killing the connection (the user then sees "Network error"). If the price
  // isn't back within the budget we return the DB price (or 0) now — the card's
  // post-save price refresh still fills in the live price moments later, so the
  // price never permanently fails. The underlying search keeps running.
  const PRICE_WAIT_MS = 12000;
  let priceWaitTimer: ReturnType<typeof setTimeout> | undefined;
  const priceWaitFallback = new Promise<number>((resolve) => {
    priceWaitTimer = setTimeout(() => resolve(0), PRICE_WAIT_MS);
    priceWaitTimer.unref?.();
  });
  const livePriceCapped: Promise<number> = Promise.race([
    livePricePromise,
    priceWaitFallback,
  ]).finally(() => clearTimeout(priceWaitTimer));

  // IMAGE FIRST (Japanese cards): kick off the deterministic LimitlessTCG JP-art
  // lookup up front, concurrently with everything else. For Japanese-only cards
  // this is the EXACT card's real artwork and is hot-linkable from prod, unlike
  // the English-twin art (wrong language/frame) or the AI web search (which
  // hallucinates 404 URLs). It takes priority over whatever a phase finds below.
  const jpImagePromise: Promise<string | null> =
    jpSet && setId ? limitlessJpImageUrl(setId, setNumber) : Promise.resolve(null);

  // Resolve the final result: prefer the live web price; fall back to the DB
  // price; otherwise 0. For JP cards the exact LimitlessTCG art wins for the
  // image; otherwise the image comes from whichever phase found it.
  const finalize = async (
    dbPrice: number,
    imageUrl: string | null,
    dbPsa10GBP: number | null = null,
  ): Promise<{ priceGBP: number; psa10GBP: number | null; imageUrl: string | null; priceNote: string | null }> => {
    const jpImg = await jpImagePromise;
    const finalImage = jpImg ?? imageUrl;
    const livePrice = await livePriceCapped;
    if (livePrice > 0) {
      return { priceGBP: livePrice, psa10GBP: dbPsa10GBP, imageUrl: finalImage, priceNote: "Price from live web search (sold listings)" };
    }
    if (dbPrice > 0) {
      return { priceGBP: dbPrice, psa10GBP: dbPsa10GBP, imageUrl: finalImage, priceNote: jpSet ? jpNote : null };
    }
    return { priceGBP: 0, psa10GBP: dbPsa10GBP, imageUrl: finalImage, priceNote: jpSet ? "Japanese card — not in price database" : null };
  };

  // ── Phase 0: Japanese cards — PriceCharting has the EXACT card + real image ──
  // Run this FIRST for Japanese sets, otherwise the English-equivalent phases
  // below return a wrong-art card (e.g. an English Froslass AR for メガユキメノコex).
  if (jpSet) {
    const pc = await priceChartingLookup(name, setNumber, setId);
    if (pc && (pc.priceGBP > 0 || pc.imageUrl)) {
      return await finalize(pc.priceGBP, pc.imageUrl, pc.psa10GBP);
    }
  }

  // ── Phase 1: direct set.id + number — only accept if same Pokémon ────────────
  if (enSetId) {
    const results = await tcgFetch(`set.id:${enSetId} number:${numStr}`, 10);
    const match = results.find(c => namesMatch(name, c.name ?? ""));
    if (match) {
      return await finalize(
        bestPrice(match),
        match.images?.large ?? match.images?.small ?? null,
      );
    }
    // Card found but different Pokémon (e.g. Bramblin at sv2-198) — skip, don't use wrong image
  }

  // ── Phase 2: AR/secret rare — find same Pokémon's AR in equivalent English set ─
  if (isSecret && firstName.length > 2) {
    const byName = await tcgFetch(`name:"${firstName}"`, 150);
    const candidates = byName.filter(c => {
      const pt = c.set?.printedTotal ?? 0;
      const cn = parseInt(c.number ?? "0", 10);
      return (
        Math.abs(pt - setTotal) <= 15 &&
        cn > pt &&
        namesMatch(name, c.name ?? "")
      );
    });
    if (candidates.length) {
      const best = candidates.sort((a, b) =>
        Math.abs(parseInt(a.number ?? "0") - setNumber) -
        Math.abs(parseInt(b.number ?? "0") - setNumber)
      )[0];
      return await finalize(
        bestPrice(best),
        best.images?.large ?? best.images?.small ?? null,
      );
    }
  }

  // ── Phase 3: number search, filter by set total, validate name ────────────────
  const byNum = await tcgFetch(`number:${numStr}`, 250);
  const withNum = byNum.filter(c => c.number === numStr || c.number === String(setNumber));
  // Only accept if the Pokémon name matches
  const namedMatch = withNum.find(
    c => namesMatch(name, c.name ?? "") && c.set?.printedTotal === setTotal
  );
  if (namedMatch) {
    return await finalize(
      bestPrice(namedMatch),
      namedMatch.images?.large ?? namedMatch.images?.small ?? null,
    );
  }
  // Closest printedTotal but still must match name
  const namedClose = withNum
    .filter(c => namesMatch(name, c.name ?? ""))
    .sort((a, b) =>
      Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
      Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
    )[0];
  if (namedClose) {
    return await finalize(
      bestPrice(namedClose),
      namedClose.images?.large ?? namedClose.images?.small ?? null,
    );
  }

  // ── Phase 4: PriceCharting — works for Japanese sets not in PokéTCG ──────────
  const pc = await priceChartingLookup(name, setNumber, setId);
  if (pc && (pc.priceGBP > 0 || pc.imageUrl)) {
    return await finalize(pc.priceGBP, pc.imageUrl, pc.psa10GBP);
  }

  // ── Phase 5: name-only fallback — IMAGE from an exact English twin, else web ──
  if (firstName.length > 2) {
    const byName = await tcgFetch(`name:"${firstName}"`, 80);
    const candidates = byName.filter(c => namesMatch(name, c.name ?? ""));
    const sortBySetTotal = (arr: TCGCard[]) =>
      [...arr].sort((a, b) =>
        Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
        Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
      );

    // IMAGE may only come from a TRUE twin — an EXACT name + EXACT number match
    // (e.g. "Mega Greninja ex" EN Chaos Rising == JP M4). The old "closest set
    // total" fallback grabbed a different card of the same Pokémon from another
    // set (e.g. Vivid Voltage "Amazing Burst" Rayquaza — wrong art). When there
    // is no exact-number twin, fetch the real official art via web search. The
    // PRICE comes from the live web search kicked off at the top (finalize).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const exactName = candidates.filter(c => norm(c.name ?? "") === norm(name));
    const numMatches = exactName.filter(c => c.number === numStr || c.number === String(setNumber));
    const twin = sortBySetTotal(numMatches)[0];
    const twinPrice = twin ? bestPrice(twin) : 0;
    let img = twin?.images?.large ?? twin?.images?.small ?? null;
    // For JP cards the image comes from the concurrent LimitlessTCG lookup
    // (jpImagePromise) which finalize() prefers, so don't also run the slow
    // ~20s AI image search here — for JP cards it only hallucinates 404 URLs
    // and would needlessly stall the response past the gateway timeout.
    if (!img && !jpSet) img = await webSearchOfficialImage(name, setNumber, setTotal, setId);

    if (jpSet || twinPrice > 0 || img || (await livePriceCapped) > 0) {
      return await finalize(twinPrice, img);
    }
  }

  // ── Phase 6: nothing in any database. Image: JP cards use the concurrent
  // LimitlessTCG lookup (via finalize); only non-JP cards fall to the AI image
  // search. The price is already running via finalize / livePriceCapped. ──────
  const webImg = jpSet ? null : await webSearchOfficialImage(name, setNumber, setTotal, setId);
  return await finalize(0, webImg);
}

/** Resolve a human-friendly set name + code + pocket count for auto-creating a binder. */
async function resolveSetInfo(
  setId: string,
  setTotalHint: number
): Promise<{ name: string; setCode: string; setTotal: number }> {
  const id = setId.trim().toLowerCase();
  const titleCase = (s: string) =>
    s.replace(/\b\w/g, (c) => c.toUpperCase());

  let name = "";
  let setTotal = setTotalHint;

  // 1. Japanese sets: our keyword map carries the real set name (e.g. m2a → "Mega Dream")
  if (id && JP_SET_TO_PC[id]) {
    name = titleCase(JP_SET_TO_PC[id]);
  }

  // 2. PokéTCG set lookup (English, or the English equivalent of a Japanese set)
  if (id) {
    const enId = JP_TO_EN[id] ?? id;
    try {
      const r = await fetch(`https://api.pokemontcg.io/v2/sets/${enId}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          data?: { name?: string; printedTotal?: number; total?: number };
        };
        const s = j.data;
        if (s) {
          if (!name && s.name) name = s.name;
          // Only trust the API total when the scan didn't supply one
          if (!setTotal && (s.printedTotal || s.total)) {
            setTotal = s.printedTotal ?? s.total ?? 0;
          }
        }
      }
    } catch {
      /* network/timeout — fall through to fallbacks */
    }
  }

  const setCode = id ? id.toUpperCase() : (name ? name.slice(0, 6).toUpperCase() : "SET");
  if (!setTotal || setTotal < 1) setTotal = setTotalHint || 9;

  // Binder name: "M2A — Mega Dream" format — set code first (matches card print),
  // then full English name for context. If no full name, just the code.
  const binderName = name && name.toUpperCase() !== setCode
    ? `${setCode} — ${name}`
    : setCode;
  return { name: binderName, setCode, setTotal };
}

// GET /api/scan/set-info?setId=m2a&setTotal=193
router.get("/set-info", async (req, res) => {
  const setId = req.query.setId ? String(req.query.setId) : "";
  const setTotal = parseInt(String(req.query.setTotal ?? "0"), 10) || 0;
  const info = await resolveSetInfo(setId, setTotal);
  res.json(info);
});

// POST /api/scan/identify
router.post("/identify", async (req, res) => {
  const { imageBase64, topCropBase64, bottomCropBase64 } = req.body as {
    imageBase64?: string;
    topCropBase64?: string;
    bottomCropBase64?: string;
  };
  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const toDataUri = (b64: string) =>
    b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "image_url", image_url: { url: toDataUri(imageBase64), detail: "high" } },
  ];
  const imgDesc: string[] = ["Image 1 is the full card."];
  let imgN = 2;
  if (topCropBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: toDataUri(topCropBase64), detail: "high" },
    });
    imgDesc.push(
      `Image ${imgN} is a 2× zoomed crop of the card's TOP. READ the Pokémon's printed NAME from this text, character by character. Do NOT guess the species from the artwork — read the literal printed name.`
    );
    imgN++;
  }
  if (bottomCropBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: toDataUri(bottomCropBase64), detail: "high" },
    });
    imgDesc.push(
      `Image ${imgN} is a 2× zoomed crop of the card's BOTTOM. Use it to read the EXACT set code, number and rarity character by character.`
    );
    imgN++;
  }
  userContent.push({
    type: "text",
    text: imgDesc.length > 1 ? imgDesc.join(" ") : "Identify this Pokémon card.",
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a Pokémon TCG card scanner. Read ONLY what is literally printed on the card — do NOT guess or use memory.

Extract these 5 fields:
1. name — the Pokémon name as the OFFICIAL ENGLISH species name. You MUST read this from the printed name text at the TOP of the card (use the zoomed top crop). NEVER identify the Pokémon from its artwork — many Pokémon look alike (e.g. ice/snow Pokémon). Read the printed characters literally and translate to the real English name:
   - Use the official English species name, NEVER romaji: "カイリュー"→"Dragonite" (NOT "Kairyu"), "ゲッコウガ"→"Greninja" (NOT "Gekkouga"), "ガブリアス"→"Garchomp", "ゲンガー"→"Gengar"
   - More examples: "ドンメル"→"Numel", "リザードン"→"Charizard", "ユキメノコ"→"Froslass", "ユキノオー"→"Abomasnow"
   - Keep the "メガ"/"Mega" prefix and the "ex"/"GX"/"V"/"VMAX"/"VSTAR" suffix EXACTLY as printed: "メガユキメノコex"→"Mega Froslass ex", "メガカイリューex"→"Mega Dragonite ex", "リザードンex"→"Charizard ex"
   - TRAINER'S POKÉMON: if a Trainer name in the possessive form (ending in "の" = "'s") is printed BEFORE the Pokémon name, you MUST include it as "{Trainer}'s {Pokémon}". This is critical — omitting it identifies a completely different card. Translate the trainer name to English: "シロナ"→"Cynthia", "カスミ"→"Misty", "サカキ"→"Giovanni", "ナンジャモ"→"Iono", "マリィ"→"Marnie", "リーリエ"→"Lillie", "ハウ"→"Hau", "グズマ"→"Guzma", "アカギ"→"Cyrus", "N"→"N". Examples: "シロナのミカルゲ"→"Cynthia's Spiritomb", "カスミのコダック"→"Misty's Psyduck", "サカキのニドキング"→"Giovanni's Nidoking".
2. setNumber — integer BEFORE the slash (e.g. 224 from "224/193")
3. setTotal — integer AFTER the slash (e.g. 193 from "224/193")
4. setId — the small set code near those numbers. Read each character individually.
   - Japanese M-series examples: "m4" (83 cards), "m2a" (193 cards), "m2b". The letter is lowercase "m", NOT "x" or "xy".
   - Do NOT confuse Japanese "m4" with English "xy4" — they are completely different sets. If the code starts with the letter M, output "m4" not "xy4".
   - Other examples: "sv2", "sv1a", "swsh12".
5. rarity — abbreviation if visible (e.g. "AR", "SAR", "SR", "RR", "MA", "R", "C")

CRITICAL:
- The NAME comes from the printed TEXT at the top, NOT from the artwork. If the text says "ユキメノコ" (Froslass) but the picture looks like another snow Pokémon, the name is Froslass.
- Read the EXACT digits of setNumber and setTotal. Do not substitute numbers from memory.
- Read the EXACT set code character by character. "m2a" ≠ "sv2a" ≠ "sv1a". "m4" ≠ "xy4".
- For AR/SAR/MA cards, setNumber exceeds setTotal (e.g. 224/193). This is normal — report it exactly.
- Set confidence to "low" if any part is unclear.

Output ONLY valid JSON, no markdown:
{"name":"Mega Froslass ex","setNumber":224,"setTotal":193,"setId":"m2a","rarity":"MA","confidence":"high"}

If the card cannot be identified at all:
{"error":"Cannot identify card","reason":"brief reason"}`,
        },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    console.log("[scan] AI:", raw);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim());
    } catch {
      res.status(422).json({ error: "AI returned unreadable response", raw });
      return;
    }

    if (parsed.error) {
      res.status(422).json({ error: parsed.error, reason: parsed.reason });
      return;
    }

    const name = normalizeSpeciesName(String(parsed.name ?? "Unknown").trim());
    const setNumber = parseInt(String(parsed.setNumber ?? "0"), 10);
    const setTotal = parseInt(String(parsed.setTotal ?? "0"), 10);
    let setId = parsed.setId ? String(parsed.setId).trim() : undefined;
    const rarity = parsed.rarity ? String(parsed.rarity).trim() : undefined;

    // Correct known AI misreads of Japanese set codes.
    // Key: what AI returned. Value: [correct code, expected English set total].
    // Only apply when the reported setTotal does NOT match the real English set
    // size — that mismatch is what proves it's actually the Japanese set.
    // Only the xy4→m4 case is verified; do not add speculative entries.
    const SET_ID_FIXES: Record<string, [string, number]> = {
      "xy4": ["m4", 119], // XY4 = Phantom Forces (119 cards); if total ≠ 119, it's M4 (83)
    };
    if (setId) {
      const fix = SET_ID_FIXES[setId.toLowerCase()];
      if (fix && setTotal !== fix[1]) {
        setId = fix[0];
      }
    }
    const confidence = String(parsed.confidence ?? "medium");

    if (!setNumber || !setTotal) {
      res.status(422).json({ error: "Could not parse set numbers", raw });
      return;
    }

    const { priceGBP, psa10GBP, imageUrl, priceNote } = await lookupCard(name, setNumber, setTotal, setId);

    res.json({ name, setNumber, setTotal, setId, rarity, confidence, priceGBP, psa10GBP, imageUrl, priceNote });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      res.status(429).json({ error: "quota_exceeded", detail: "OpenAI quota exceeded. Enter card details manually." });
      return;
    }
    res.status(500).json({ error: "AI identification failed", detail: msg });
  }
});

export default router;
