import { Router } from "express";
import OpenAI from "openai";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

// ── Japanese set ID → closest English set ID in PokéTCG ──────────────────────
const JP_TO_EN: Record<string, string> = {
  // Scarlet & Violet era
  "sv1a": "sv1",   "sv1s": "sv1",   "sv1v": "sv1",
  "sv2a": "sv2",   "sv2d": "sv2",
  "sv3a": "sv3",   "sv3pt5a": "sv3pt5",
  "sv4a": "sv4",   "sv4k": "sv4",
  "sv5a": "sv5",   "sv5k": "sv5",   "sv5m": "sv5",
  "sv6a": "sv6",
  "sv7a": "sv7",
  "sv8a": "sv8",
  // Sword & Shield era
  "s12a": "swsh12",  "s11a": "swsh11",  "s10a": "swsh10",
  "s9a": "swsh9",    "s8a": "swsh8",    "s7d": "swsh7",
  "s6a": "swsh6",    "s5a": "swsh5",    "s4a": "swsh4",
  "s3a": "swsh3",    "s2a": "swsh2",
};

// Known Japanese set ID patterns (starts with sv + letters, or s + digits + letter)
function isJapaneseSet(setId: string): boolean {
  return /^(sv\d+[a-z]+|s\d+[a-z])/i.test(setId);
}

type TCGCard = {
  name?: string;
  number?: string;
  set?: { id?: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, { market?: number; mid?: number }> };
  cardmarket?: { prices?: { averageSellPrice?: number; trendPrice?: number } };
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

async function lookupCard(
  name: string,
  setNumber: number,
  setTotal: number,
  setId?: string
): Promise<{ priceGBP: number; imageUrl: string | null; priceNote: string | null }> {
  const numStr = String(setNumber).padStart(3, "0");
  const isSecret = setNumber > setTotal;  // AR / SAR / UR
  const jpSet = setId ? isJapaneseSet(setId) : false;
  const enSetId = setId ? (JP_TO_EN[setId.toLowerCase()] ?? (!jpSet ? setId.toLowerCase() : null)) : null;

  // Normalise name for search: strip "ex"/"GX"/"V" suffix variants, take first real word
  const baseName = name.replace(/[-\s]?(ex|GX|V|VMAX|VSTAR|AR|SAR|UR|SR|RR)$/i, "").trim();
  const firstName = baseName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");

  const note = jpSet
    ? "Japanese card — price shown is for nearest English equivalent"
    : null;

  // ── Phase 1: direct set.id + number (most accurate — English sets) ──────────
  if (enSetId) {
    const [direct1, direct2] = await Promise.all([
      tcgFetch(`set.id:${enSetId} number:${numStr}`, 10),
      tcgFetch(`set.id:${enSetId} number:${setNumber}`, 10),
    ]);
    const direct = [...direct1, ...direct2];
    if (direct.length) {
      const best = direct[0];
      return { priceGBP: bestPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote: note };
    }
  }

  // ── Phase 2: for secret/AR cards — search by Pokémon name, find the right set's AR ──
  if (isSecret && firstName.length > 2) {
    const byName = await tcgFetch(`name:"${firstName}"`, 150);
    // Cards in a set whose printedTotal is within ±10 of setTotal AND card number > printedTotal
    const candidates = byName.filter(c => {
      const pt = c.set?.printedTotal ?? 0;
      const cn = parseInt(c.number ?? "0", 10);
      return Math.abs(pt - setTotal) <= 10 && cn > pt;
    });
    if (candidates.length) {
      // Prefer number closest to what AI reported
      const best = candidates.sort((a, b) =>
        Math.abs(parseInt(a.number ?? "0") - setNumber) -
        Math.abs(parseInt(b.number ?? "0") - setNumber)
      )[0];
      return { priceGBP: bestPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote: note };
    }
  }

  // ── Phase 3: normal cards — number search, filter by set total ──────────────
  const [byNum1, byNum2] = await Promise.all([
    tcgFetch(`number:${numStr}`, 250),
    isSecret ? tcgFetch(`number:${setNumber}`, 50) : Promise.resolve([] as TCGCard[]),
  ]);
  const byNum = [...byNum1, ...byNum2];
  const withCorrectNum = byNum.filter(c => c.number === numStr || c.number === String(setNumber));
  const exactSet = withCorrectNum.find(c => c.set?.printedTotal === setTotal);
  if (exactSet) return { priceGBP: bestPrice(exactSet), imageUrl: exactSet.images?.large ?? exactSet.images?.small ?? null, priceNote: note };
  const closestSet = withCorrectNum.sort((a, b) =>
    Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
    Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
  )[0];
  if (closestSet) return { priceGBP: bestPrice(closestSet), imageUrl: closestSet.images?.large ?? closestSet.images?.small ?? null, priceNote: note };

  // ── Phase 4: name-only fallback — at least show this Pokémon ────────────────
  if (firstName.length > 2) {
    const byName = await tcgFetch(`name:"${firstName}"`, 80);
    if (byName.length) {
      // Sort by printedTotal closeness
      const best = byName.sort((a, b) =>
        Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
        Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
      )[0];
      const fallbackNote = jpSet
        ? "Japanese card — price from closest English equivalent"
        : "Price from similar card (exact not found)";
      return { priceGBP: bestPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote: fallbackNote };
    }
  }

  return { priceGBP: 0, imageUrl: null, priceNote: null };
}

// POST /api/scan/identify
router.post("/identify", async (req, res) => {
  const { imageBase64, bottomCropBase64 } = req.body as {
    imageBase64?: string;
    bottomCropBase64?: string;
  };

  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const toDataUri = (b64: string, mime = "image/jpeg") =>
    b64.startsWith("data:") ? b64 : `data:${mime};base64,${b64}`;

  const fullUri = toDataUri(imageBase64);
  const cropUri = bottomCropBase64 ? toDataUri(bottomCropBase64) : null;

  try {
    // Build message content — always send full card; also send bottom crop when available
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: "image_url",
        image_url: { url: fullUri, detail: "high" },
      },
    ];
    if (cropUri) {
      userContent.push({
        type: "image_url",
        image_url: { url: cropUri, detail: "high" },
      });
    }
    userContent.push({
      type: "text",
      text: cropUri
        ? "Image 1 is the full card. Image 2 is a zoomed crop of the card's bottom section. Use Image 2 to read the exact set code, number and rarity."
        : "Identify this Pokémon card.",
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 300,
      temperature: 0,   // deterministic — no creative guessing
      messages: [
        {
          role: "system",
          content: `You are a Pokémon TCG card scanner. Your ONLY job is to read what is literally printed on the card — do NOT guess, invent, or rely on memory of what a card "should" say.

Extract these 5 fields from the card photos:

1. name — the Pokémon's name in ENGLISH (translate Japanese if needed). e.g. "ドンメル" → "Numel".
2. setNumber — the integer BEFORE the slash in the bottom number, e.g. 196 from "196/193".
3. setTotal — the integer AFTER the slash, e.g. 193 from "196/193".
4. setId — the small alphanumeric set code printed near those numbers, e.g. "sv1a", "sv2a", "swsh12". Read each character individually. "sv1a" and "sv2a" are DIFFERENT codes.
5. rarity — the rarity abbreviation if visible, e.g. "AR", "SAR", "SR", "RR", "R", "C".

CRITICAL RULES:
- Read the EXACT digits of setNumber and setTotal from the image. Do not substitute numbers from memory.
- Read the EXACT set code character by character. sv1a ≠ sv2a ≠ sv3a.
- If the card is in a plastic case or has glare, focus on what IS legible.
- If you cannot confidently read a field, set confidence to "low" and make your best attempt.
- Never return a setNumber that seems completely unrelated to the card you can see.

Output ONLY valid JSON — no markdown, no explanation:
{"name":"Numel","setNumber":196,"setTotal":193,"setId":"sv1a","rarity":"AR","confidence":"high"}

If you cannot identify the card at all:
{"error":"Cannot identify card","reason":"brief reason"}`,
        },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    console.log("[scan] AI raw:", raw);

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

    const name = String(parsed.name ?? "Unknown").trim();
    const setNumber = parseInt(String(parsed.setNumber ?? "0"), 10);
    const setTotal = parseInt(String(parsed.setTotal ?? "0"), 10);
    const setId = parsed.setId ? String(parsed.setId).trim() : undefined;
    const rarity = parsed.rarity ? String(parsed.rarity).trim() : undefined;
    const confidence = String(parsed.confidence ?? "medium");

    if (!setNumber || !setTotal) {
      res.status(422).json({ error: "Could not parse set numbers", raw });
      return;
    }

    // Run the PokéTCG lookup (already async, start immediately)
    const { priceGBP, imageUrl, priceNote } = await lookupCard(name, setNumber, setTotal, setId);

    res.json({ name, setNumber, setTotal, setId, rarity, confidence, priceGBP, imageUrl, priceNote });
  } catch (err: unknown) {
    console.error("[scan] error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      res.status(429).json({ error: "quota_exceeded", detail: "OpenAI quota exceeded. Enter card details manually." });
      return;
    }
    res.status(500).json({ error: "AI identification failed", detail: msg });
  }
});

export default router;
