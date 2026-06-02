import { Router } from "express";
import OpenAI from "openai";
import { db, bindersTable, cardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

type PokeTCGCard = {
  name?: string;
  number?: string;
  set?: { printedTotal?: number; total?: number };
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
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) return [];
  const json = await res.json() as { data?: PokeTCGCard[] };
  return json.data ?? [];
}

async function fetchPriceAndImageGBP(
  name: string,
  setNumber: number,
  setTotal: number
): Promise<{ priceGBP: number; imageUrl: string | null; officialName: string | null }> {
  const numStr = String(setNumber).padStart(3, "0");

  const pickBySetTotal = (cards: PokeTCGCard[]): PokeTCGCard | null => {
    // Match exact number string then filter by set printedTotal == setTotal
    const withNum = cards.filter(c => c.number === numStr || c.number === String(setNumber));
    const exact = withNum.find(c => c.set?.printedTotal === setTotal || c.set?.total === setTotal);
    if (exact) return exact;
    // Fallback: closest printedTotal to setTotal
    if (withNum.length) {
      return withNum.sort((a, b) =>
        Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
        Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
      )[0];
    }
    return null;
  };

  try {
    // Strategy 1: number-based lookup, large page, filter by set total client-side
    const byNumber = await pokeTCGFetch(`number:${numStr}`, 250);
    const match1 = pickBySetTotal(byNumber);
    if (match1) {
      return {
        priceGBP: extractPrice(match1) || 0.99,
        imageUrl: match1.images?.large ?? match1.images?.small ?? null,
        officialName: match1.name ?? null,
      };
    }

    // Strategy 2: name + number, no set filter (different page — broader search)
    const firstName = name.split(/\s+/)[0];
    const byName = await pokeTCGFetch(`name:"${firstName}" number:${setNumber}`, 50);
    if (byName.length) {
      const best = byName.find(c => c.set?.printedTotal === setTotal) ?? byName[0];
      return {
        priceGBP: extractPrice(best) || 0.99,
        imageUrl: best.images?.large ?? best.images?.small ?? null,
        officialName: best.name ?? null,
      };
    }
  } catch (err) {
    console.warn("PokéTCG lookup failed:", err);
  }

  return { priceGBP: 0, imageUrl: null, officialName: null };
}

// POST /api/scan/identify
// Body: { imageBase64: string }  (data URI or raw base64)
router.post("/identify", async (req, res) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  // Ensure it's a proper data URI
  const dataUri = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `You are a Pokémon Trading Card Game expert. When shown a photo of a Pokémon card, extract:
1. The card name (in English even if the card is in Japanese)
2. The set number (the number before the slash, e.g. 026 from "026/193")
3. The set total (the number after the slash, e.g. 193 from "026/193")

The set number is printed in small text near the bottom of the card, often bottom-left or bottom-right, in format NNN/NNN.

Respond ONLY with valid JSON in this exact format, no other text:
{"name":"Card Name","setNumber":26,"setTotal":193,"confidence":"high|medium|low"}

If you cannot identify the card or read the set number, respond with:
{"error":"Cannot identify card","reason":"brief reason"}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUri, detail: "high" },
            },
            {
              type: "text",
              text: "Identify this Pokémon card and extract the set number.",
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    let parsed: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
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
    const confidence = String(parsed.confidence ?? "medium");

    if (!setNumber || !setTotal) {
      res.status(422).json({ error: "Could not parse set numbers from AI response", raw });
      return;
    }

    // Fetch real price + official card art from PokéTCG
    // We trust the AI for the name (it reads the actual card); PokéTCG is used for price + image only
    const { priceGBP, imageUrl } = await fetchPriceAndImageGBP(name, setNumber, setTotal);

    res.json({
      name,
      setNumber,
      setTotal,
      confidence,
      priceGBP,
      imageUrl,
    });
  } catch (err: unknown) {
    console.error("AI scan error:", err);
    const message = err instanceof Error ? err.message : String(err);
    // Surface quota errors distinctly so the client can show manual entry
    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      res.status(429).json({ error: "quota_exceeded", detail: "OpenAI quota exceeded. Enter card details manually." });
      return;
    }
    res.status(500).json({ error: "AI identification failed", detail: message });
  }
});

export default router;
