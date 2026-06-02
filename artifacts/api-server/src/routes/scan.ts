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

async function fetchPriceAndImageGBP(
  name: string,
  setNumber: number,
  setTotal: number
): Promise<{ priceGBP: number; imageUrl: string | null; officialName: string | null }> {
  try {
    const numStr = String(setNumber).padStart(3, "0");
    const queries = [
      `name:"${name}" number:${setNumber}`,
      `name:"${name.split(" ")[0]}" number:${setNumber}`,
      `number:${numStr}`,
    ];

    for (const q of queries) {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=5&select=tcgplayer,cardmarket,name,number,images`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;

      const json = await res.json() as {
        data: Array<{
          name?: string;
          number?: string;
          images?: { small?: string; large?: string };
          tcgplayer?: { prices?: Record<string, { market?: number }> };
          cardmarket?: { prices?: { averageSellPrice?: number } };
        }>;
      };
      const cards = json.data ?? [];
      if (!cards.length) continue;

      // Pick the best match by set number
      const best = cards.find(c => c.number === String(setNumber) || c.number === numStr) ?? cards[0];

      let priceGBP = 0;
      const tcgPrices = best.tcgplayer?.prices;
      if (tcgPrices) {
        const usd =
          tcgPrices["holofoil"]?.market ??
          tcgPrices["normal"]?.market ??
          tcgPrices["reverseHolofoil"]?.market ??
          Object.values(tcgPrices)[0]?.market;
        if (usd && usd > 0) priceGBP = parseFloat((usd * USD_TO_GBP).toFixed(2));
      }
      if (!priceGBP) {
        const cm = best.cardmarket?.prices?.averageSellPrice;
        if (cm && cm > 0) priceGBP = parseFloat((cm * EUR_TO_GBP).toFixed(2));
      }

      const imageUrl = best.images?.large ?? best.images?.small ?? null;
      const officialName = best.name ?? null;

      return { priceGBP: priceGBP || 1.99, imageUrl, officialName };
    }
  } catch (err) {
    console.warn("PokéTCG lookup failed:", err);
  }

  // Fallback price
  const seed = (name.length * setNumber * 17) % 5000;
  return { priceGBP: parseFloat((1.5 + seed / 100).toFixed(2)), imageUrl: null, officialName: null };
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
    const { priceGBP, imageUrl, officialName } = await fetchPriceAndImageGBP(name, setNumber, setTotal);

    res.json({
      name: officialName ?? name,
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
