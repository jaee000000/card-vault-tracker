import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

type PokeTCGCard = {
  name?: string;
  number?: string;
  set?: { id?: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, { market?: number }> };
  cardmarket?: { prices?: { averageSellPrice?: number } };
};

function extractPrice(card: PokeTCGCard): number {
  const tcgPrices = card.tcgplayer?.prices;
  if (tcgPrices) {
    const usd =
      tcgPrices["holofoil"]?.market ??
      tcgPrices["normal"]?.market ??
      tcgPrices["reverseHolofoil"]?.market ??
      Object.values(tcgPrices)[0]?.market;
    if (usd && usd > 0) return parseFloat((usd * USD_TO_GBP).toFixed(2));
  }
  const cm = card.cardmarket?.prices?.averageSellPrice;
  if (cm && cm > 0) return parseFloat((cm * EUR_TO_GBP).toFixed(2));
  return 0;
}

async function pokeTCGFetch(q: string, pageSize = 250): Promise<PokeTCGCard[]> {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}&select=tcgplayer,cardmarket,name,number,set,images`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return [];
    const json = await res.json() as { data?: PokeTCGCard[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

// Map Japanese set IDs to their closest English equivalent set ID in PokéTCG
const JP_TO_EN_SET: Record<string, string> = {
  sv2a: "sv2",   // Japanese Paldea Evolved → English Paldea Evolved
  sv1a: "sv1",
  sv3a: "sv3",
  sv4a: "sv4",
  sv5a: "sv5",
  sv6a: "sv6",
  sv7a: "sv7",
  sv8a: "sv8",
  sv1s: "sv1",
  sv2s: "sv2",
};

async function fetchPriceAndImage(
  name: string,
  setNumber: number,
  setTotal: number,
  setId?: string
): Promise<{ priceGBP: number; imageUrl: string | null; priceNote: string | null }> {
  const numStr = String(setNumber).padStart(3, "0");
  const isSecretRare = setNumber > setTotal; // AR, SAR, UR, SR cards

  // Resolve: if this is a known Japanese-only set, map to English equivalent for lookup
  const resolvedSetId = setId
    ? (JP_TO_EN_SET[setId.toLowerCase()] ?? setId.toLowerCase())
    : null;
  const isJapanese = setId ? setId in JP_TO_EN_SET : false;
  const priceNote = isJapanese
    ? "Japanese card — price shown is for nearest English equivalent"
    : null;

  // ── Phase 1: direct set.id + number lookup (most accurate when setId known) ──
  if (resolvedSetId) {
    const direct = await pokeTCGFetch(`set.id:${resolvedSetId} number:${numStr}`, 10);
    if (direct.length) {
      const best = direct[0];
      return { priceGBP: extractPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote };
    }
  }

  // ── Phase 2: for AR/SR/SAR cards — name-first search, find the secret rare version ──
  if (isSecretRare) {
    const firstName = name.split(/\s+/)[0].replace(/[^a-zA-Z]/g, "");
    const byName = await pokeTCGFetch(`name:"${firstName}"`, 100);

    // Find cards in a set with matching printedTotal that are themselves secret rares (number > printedTotal)
    const inRightSet = byName.filter(c => {
      const pt = c.set?.printedTotal;
      const cardNum = parseInt(c.number ?? "0", 10);
      return pt && Math.abs(pt - setTotal) <= 5 && cardNum > (pt ?? 0);
    });

    if (inRightSet.length) {
      // Prefer the one with closest number to what AI reported
      const best = inRightSet.sort((a, b) =>
        Math.abs(parseInt(a.number ?? "0", 10) - setNumber) -
        Math.abs(parseInt(b.number ?? "0", 10) - setNumber)
      )[0];
      return { priceGBP: extractPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote };
    }

    // Phase 2b: any card of this Pokémon from a set with matching printedTotal
    const anyMatch = byName.find(c => Math.abs((c.set?.printedTotal ?? 9999) - setTotal) <= 5);
    if (anyMatch) {
      return { priceGBP: extractPrice(anyMatch), imageUrl: anyMatch.images?.large ?? anyMatch.images?.small ?? null, priceNote: "Price from related card version" };
    }
  }

  // ── Phase 3: normal cards — search by number, filter client-side by set printedTotal ──
  const byNumber = await pokeTCGFetch(`number:${numStr}`, 250);
  const withNum = byNumber.filter(c => c.number === numStr || c.number === String(setNumber));
  const exact = withNum.find(c => c.set?.printedTotal === setTotal);
  if (exact) {
    return { priceGBP: extractPrice(exact), imageUrl: exact.images?.large ?? exact.images?.small ?? null, priceNote };
  }
  // Closest printedTotal match
  if (withNum.length) {
    const closest = withNum.sort((a, b) =>
      Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
      Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
    )[0];
    return { priceGBP: extractPrice(closest), imageUrl: closest.images?.large ?? closest.images?.small ?? null, priceNote };
  }

  // ── Phase 4: name-only fallback — at least show the right Pokémon ──
  const firstName = name.split(/\s+/)[0].replace(/[^a-zA-Z]/g, "");
  if (firstName.length > 2) {
    const byName = await pokeTCGFetch(`name:"${firstName}"`, 50);
    if (byName.length) {
      const best = byName.sort((a, b) =>
        Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
        Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
      )[0];
      return { priceGBP: extractPrice(best), imageUrl: best.images?.large ?? best.images?.small ?? null, priceNote: "Price from similar card (exact not found)" };
    }
  }

  return { priceGBP: 0, imageUrl: null, priceNote: null };
}

// POST /api/scan/identify
router.post("/identify", async (req, res) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const dataUri = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You are a Pokémon TCG expert with perfect vision. Examine the card photo carefully and extract:

1. **Card name** — translate to English if the card is Japanese (e.g. "ドンメル" → "Numel", "リザードン" → "Charizard")
2. **Set number** — the number BEFORE the slash at the bottom of the card (e.g. 198 from "198/193")
3. **Set total** — the number AFTER the slash (e.g. 193 from "198/193")
4. **Set ID** — the small alphanumeric code printed near the set number, e.g. "sv2", "sv2a", "swsh12", "xy5". Include the letter suffix if present (e.g. "sv2a" not just "sv2").
5. **Rarity** — e.g. "AR", "SAR", "UR", "SR", "RR", "R", "C", "U"

IMPORTANT:
- For Alternate Rare (AR), Special Art Rare (SAR), or other secret rare cards, the set number EXCEEDS the set total (e.g. 198/193). Read each digit of the number very carefully — do not guess.
- The set ID and rarity are tiny text near the bottom-left or bottom-right corner, e.g. "sv2a 198/193 AR"
- If the card is Japanese, still return the English name.

Respond ONLY with valid JSON, no other text:
{"name":"Card Name","setNumber":198,"setTotal":193,"setId":"sv2a","rarity":"AR","confidence":"high|medium|low"}

If you cannot identify the card:
{"error":"Cannot identify card","reason":"brief reason"}`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUri, detail: "high" } },
            { type: "text", text: "Identify this Pokémon card. Read the set number, set total, set ID and rarity from the bottom of the card carefully." },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    console.log("AI response:", raw);

    let parsed: Record<string, unknown>;
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      res.status(422).json({ error: "AI returned unreadable response", raw });
      return;
    }

    if (parsed.error) {
      res.status(422).json({ error: parsed.error, reason: parsed.reason });
      return;
    }

    const name = String(parsed.name ?? "Unknown");
    const setNumber = parseInt(String(parsed.setNumber), 10);
    const setTotal = parseInt(String(parsed.setTotal), 10);
    const setId = parsed.setId ? String(parsed.setId).trim().toLowerCase() : undefined;
    const rarity = parsed.rarity ? String(parsed.rarity).trim() : undefined;
    const confidence = String(parsed.confidence ?? "medium");

    if (!setNumber || !setTotal) {
      res.status(422).json({ error: "Could not parse set numbers from AI response", raw });
      return;
    }

    const { priceGBP, imageUrl, priceNote } = await fetchPriceAndImage(name, setNumber, setTotal, setId);

    res.json({ name, setNumber, setTotal, setId, rarity, confidence, priceGBP, imageUrl, priceNote });
  } catch (err: unknown) {
    console.error("AI scan error:", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      res.status(429).json({ error: "quota_exceeded", detail: "OpenAI quota exceeded. Enter card details manually." });
      return;
    }
    res.status(500).json({ error: "AI identification failed", detail: message });
  }
});

export default router;
