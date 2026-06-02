import { Router } from "express";
import OpenAI from "openai";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

// Japanese set ID → nearest English set ID in PokéTCG
const JP_TO_EN: Record<string, string> = {
  "m2a": "sv2",   // Japanese "Mega Dream" (198/193) → English Paldea Evolved (193)
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

function isJapaneseSet(id: string): boolean {
  const low = id.toLowerCase();
  return low in JP_TO_EN || /^(sv\d+[a-z]|s\d+[a-z])/i.test(low);
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
  const isSecret = setNumber > setTotal;
  const jpSet = setId ? isJapaneseSet(setId) : false;
  const enSetId = setId
    ? (JP_TO_EN[setId.toLowerCase()] ?? (!jpSet ? setId.toLowerCase() : null))
    : null;

  const baseName = name.replace(/[-\s]?(ex|GX|V|VMAX|VSTAR|AR|SAR|UR|SR|RR)$/i, "").trim();
  const firstName = baseName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");

  const jpNote = "Japanese card — price shown is for nearest English equivalent";

  // ── Phase 1: direct set.id + number — only accept if same Pokémon ────────────
  if (enSetId) {
    const results = await tcgFetch(`set.id:${enSetId} number:${numStr}`, 10);
    const match = results.find(c => namesMatch(name, c.name ?? ""));
    if (match) {
      return {
        priceGBP: bestPrice(match),
        imageUrl: match.images?.large ?? match.images?.small ?? null,
        priceNote: jpSet ? jpNote : null,
      };
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
      return {
        priceGBP: bestPrice(best),
        imageUrl: best.images?.large ?? best.images?.small ?? null,
        priceNote: jpSet ? jpNote : null,
      };
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
    return {
      priceGBP: bestPrice(namedMatch),
      imageUrl: namedMatch.images?.large ?? namedMatch.images?.small ?? null,
      priceNote: jpSet ? jpNote : null,
    };
  }
  // Closest printedTotal but still must match name
  const namedClose = withNum
    .filter(c => namesMatch(name, c.name ?? ""))
    .sort((a, b) =>
      Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
      Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
    )[0];
  if (namedClose) {
    return {
      priceGBP: bestPrice(namedClose),
      imageUrl: namedClose.images?.large ?? namedClose.images?.small ?? null,
      priceNote: jpSet ? jpNote : null,
    };
  }

  // ── Phase 4: name-only fallback — price estimate, NO image (wrong art) ────────
  if (firstName.length > 2) {
    const byName = await tcgFetch(`name:"${firstName}"`, 80);
    const matched = byName
      .filter(c => namesMatch(name, c.name ?? ""))
      .sort((a, b) =>
        Math.abs((a.set?.printedTotal ?? 9999) - setTotal) -
        Math.abs((b.set?.printedTotal ?? 9999) - setTotal)
      )[0];
    if (matched) {
      const note = jpSet
        ? "Japanese card — price estimate from English equivalent (image unavailable)"
        : "Approximate price — exact card not found";
      // Return price but NO image — Phase 4 image would show wrong card art
      return { priceGBP: bestPrice(matched), imageUrl: null, priceNote: note };
    }
  }

  return { priceGBP: 0, imageUrl: null, priceNote: jpSet ? "Japanese card — not in price database" : null };
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

  const toDataUri = (b64: string) =>
    b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "image_url", image_url: { url: toDataUri(imageBase64), detail: "high" } },
  ];
  if (bottomCropBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: toDataUri(bottomCropBase64), detail: "high" },
    });
  }
  userContent.push({
    type: "text",
    text: bottomCropBase64
      ? "Image 1 is the full card. Image 2 is a 2× zoomed crop of the card's bottom section. Use Image 2 to read the EXACT set code, number and rarity character by character."
      : "Identify this Pokémon card.",
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
1. name — Pokémon name in ENGLISH (translate Japanese: "ドンメル"→"Numel", "リザードン"→"Charizard")
2. setNumber — integer BEFORE the slash (e.g. 198 from "198/193")
3. setTotal — integer AFTER the slash (e.g. 193 from "198/193")
4. setId — the small set code near those numbers (e.g. "sv2", "sv1a", "m2a", "swsh12"). Read each character individually.
5. rarity — abbreviation if visible (e.g. "AR", "SAR", "SR", "RR", "R", "C")

CRITICAL:
- Read the EXACT digits of setNumber and setTotal. Do not substitute numbers from memory.
- Read the EXACT set code character by character. "m2a" ≠ "sv2a" ≠ "sv1a".
- For AR/SAR cards, setNumber exceeds setTotal (e.g. 198/193). This is normal — report it exactly.
- Set confidence to "low" if any part is unclear.

Output ONLY valid JSON, no markdown:
{"name":"Numel","setNumber":198,"setTotal":193,"setId":"m2a","rarity":"AR","confidence":"high"}

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

    const { priceGBP, imageUrl, priceNote } = await lookupCard(name, setNumber, setTotal, setId);

    res.json({ name, setNumber, setTotal, setId, rarity, confidence, priceGBP, imageUrl, priceNote });
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
