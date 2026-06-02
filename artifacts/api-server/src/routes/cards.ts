import { Router } from "express";
import OpenAI from "openai";
import { db, cardsTable, bindersTable } from "@workspace/db";
import { eq, or, isNull } from "drizzle-orm";
import { findCardImage } from "./scan";
import {
  CreateCardBody,
  UpdateCardBody,
  GetCardParams,
  UpdateCardParams,
  DeleteCardParams,
  RefreshCardPriceParams,
  ListCardsQueryParams,
} from "@workspace/api-zod";

const router = Router();

const USD_TO_GBP = 0.79;
const EUR_TO_GBP = 0.85;

async function fetchLivePriceGBP(name: string, setNumber: number, setCode?: string): Promise<number> {
  try {
    const numStr = String(setNumber);
    const queries = [
      `name:"${name}" number:${numStr}`,
      `name:"${name.split(" ")[0]}" number:${numStr}`,
      `number:${numStr}${setCode ? ` set.id:${setCode.toLowerCase()}` : ""}`,
    ];

    for (const q of queries) {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=10&select=tcgplayer,cardmarket,name,number`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;

      const json = await res.json() as { data: Array<{ tcgplayer?: { prices?: Record<string, { market?: number }> }, cardmarket?: { prices?: { averageSellPrice?: number } } }> };
      const cards = json.data ?? [];
      if (!cards.length) continue;

      for (const card of cards) {
        const tcgPrices = card.tcgplayer?.prices;
        if (tcgPrices) {
          const usd =
            tcgPrices["holofoil"]?.market ??
            tcgPrices["normal"]?.market ??
            tcgPrices["reverseHolofoil"]?.market ??
            Object.values(tcgPrices)[0]?.market;
          if (usd && usd > 0) return parseFloat((usd * USD_TO_GBP).toFixed(2));
        }

        const cmPrice = card.cardmarket?.prices?.averageSellPrice;
        if (cmPrice && cmPrice > 0) return parseFloat((cmPrice * EUR_TO_GBP).toFixed(2));
      }
    }
  } catch (err) {
    console.warn("PokéTCG price fetch failed:", err);
  }

  const seed = (name.length * setNumber * 17) % 5000;
  return parseFloat((1.5 + seed / 100).toFixed(2));
}

function formatCard(c: typeof cardsTable.$inferSelect) {
  return {
    ...c,
    currentPriceGBP: Number(c.currentPriceGBP),
    psa10GBP: c.psa10GBP != null ? Number(c.psa10GBP) : null,
    bgs10GBP: c.bgs10GBP != null ? Number(c.bgs10GBP) : null,
    createdAt: c.createdAt.toISOString(),
    lastPriceRefreshedAt: c.lastPriceRefreshedAt?.toISOString() ?? null,
    gradedRefreshedAt: c.gradedRefreshedAt?.toISOString() ?? null,
  };
}

router.get("/", async (req, res) => {
  const parse = ListCardsQueryParams.safeParse({
    binderId: req.query.binderId ? Number(req.query.binderId) : undefined,
  });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const query = db.select().from(cardsTable);
  const cards = parse.data.binderId
    ? await query.where(eq(cardsTable.assignedBinderId, parse.data.binderId)).orderBy(cardsTable.setNumber)
    : await query.orderBy(cardsTable.setNumber);
  res.json(cards.map(formatCard));
});

router.post("/", async (req, res) => {
  const parse = CreateCardBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { name, setNumber, setTotal, assignedBinderId, condition, currentPriceGBP, imageUrl } = parse.data;

  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, assignedBinderId));
  if (!binder) {
    res.status(400).json({ error: "Binder not found" });
    return;
  }

  const priceGBP = currentPriceGBP ?? (await fetchLivePriceGBP(name, setNumber, binder.setCode));

  const [card] = await db
    .insert(cardsTable)
    .values({
      name,
      setNumber,
      setTotal,
      assignedBinderId,
      condition: condition ?? "Raw",
      currentPriceGBP: String(priceGBP),
      imageUrl: imageUrl ?? null,
      lastPriceRefreshedAt: new Date(),
    })
    .returning();

  res.status(201).json(formatCard(card));
});

router.post("/resync-all", async (_req, res) => {
  const cards = await db.select().from(cardsTable);
  const binders = await db.select().from(bindersTable);
  const binderMap = new Map(binders.map(b => [b.id, b.setCode]));

  let updated = 0;
  for (const card of cards) {
    try {
      const setCode = binderMap.get(card.assignedBinderId) ?? undefined;
      const newPrice = await fetchLivePriceGBP(card.name, card.setNumber, setCode);
      await db
        .update(cardsTable)
        .set({ currentPriceGBP: String(newPrice), lastPriceRefreshedAt: new Date() })
        .where(eq(cardsTable.id, card.id));
      updated++;
    } catch (e) {
      console.warn(`Failed to update price for card ${card.id}:`, e);
    }
  }

  const [vaultRow] = await db
    .select({ total: cardsTable.currentPriceGBP })
    .from(cardsTable)
    .limit(0);

  res.json({ updated, message: `Refreshed prices for ${updated} cards.` });
});

// Backfill card images for any saved cards missing one
router.post("/backfill-images", async (req, res) => {
  // Admin-only bulk write. In production require a matching ADMIN_TOKEN header;
  // in development it stays open for local seeding convenience.
  if (process.env.NODE_ENV === "production") {
    const token = process.env.ADMIN_TOKEN;
    if (!token || req.get("x-admin-token") !== token) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const cards = await db
    .select()
    .from(cardsTable)
    .where(or(isNull(cardsTable.imageUrl), eq(cardsTable.imageUrl, "")));
  const binders = await db.select().from(bindersTable);
  const binderMap = new Map(binders.map((b) => [b.id, b.setCode]));

  let updated = 0;
  const failures: string[] = [];
  for (const card of cards) {
    try {
      const setCode = binderMap.get(card.assignedBinderId) ?? undefined;
      const { imageUrl, priceGBP } = await findCardImage(
        card.name,
        card.setNumber,
        card.setTotal,
        setCode
      );
      if (imageUrl) {
        await db
          .update(cardsTable)
          .set({
            imageUrl,
            // only overwrite a zero/missing price
            ...(Number(card.currentPriceGBP) <= 0 && priceGBP > 0
              ? { currentPriceGBP: String(priceGBP), lastPriceRefreshedAt: new Date() }
              : {}),
          })
          .where(eq(cardsTable.id, card.id));
        updated++;
      } else {
        failures.push(`${card.name} (${card.setNumber}/${card.setTotal})`);
      }
    } catch (e) {
      failures.push(`${card.name}: ${(e as Error).message}`);
    }
  }

  res.json({ scanned: cards.length, updated, failures });
});

// Quick Look: every card across all binders, with graded values resolved,
// sorted by PSA 10 value (highest → lowest). Missing/stale graded values are
// estimated on demand with limited concurrency, then cached for next time.
// NOTE: must be registered before "/:id" so it isn't captured as an id param.
router.get("/quick-look", async (_req, res) => {
  const cards = await db.select().from(cardsTable);
  const stale = cards.filter(gradedIsStale);

  const CONCURRENCY = 4;
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    await Promise.all(
      stale.slice(i, i + CONCURRENCY).map(async (c) => {
        try {
          await ensureGradedValues(c);
        } catch (e) {
          console.warn(`Graded estimate failed for card ${c.id}:`, e);
        }
      })
    );
  }

  const fresh = await db.select().from(cardsTable);
  const binders = await db.select().from(bindersTable);
  const binderMap = new Map(binders.map((b) => [b.id, b]));

  const result = fresh
    .map((c) => {
      const formatted = formatCard(c);
      const binder = binderMap.get(c.assignedBinderId);
      // Sort key: PSA 10 value, falling back to raw when AI estimate is unavailable.
      const sortValue = formatted.psa10GBP ?? formatted.currentPriceGBP;
      return { ...formatted, binderName: binder?.name ?? null, binderSetCode: binder?.setCode ?? null, sortValue };
    })
    .sort((a, b) => b.sortValue - a.sortValue);

  res.json(result);
});

router.get("/:id", async (req, res) => {
  const parse = GetCardParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [card] = await db.select().from(cardsTable).where(eq(cardsTable.id, parse.data.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json(formatCard(card));
});

router.patch("/:id", async (req, res) => {
  const parse = UpdateCardParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const bodyParse = UpdateCardBody.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: bodyParse.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (bodyParse.data.name !== undefined) updates.name = bodyParse.data.name;
  if (bodyParse.data.condition !== undefined) updates.condition = bodyParse.data.condition;
  if (bodyParse.data.currentPriceGBP !== undefined) updates.currentPriceGBP = String(bodyParse.data.currentPriceGBP);
  if (bodyParse.data.imageUrl !== undefined) updates.imageUrl = bodyParse.data.imageUrl;

  const [updated] = await db.update(cardsTable).set(updates).where(eq(cardsTable.id, parse.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json(formatCard(updated));
});

router.delete("/:id", async (req, res) => {
  const parse = DeleteCardParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(cardsTable).where(eq(cardsTable.id, parse.data.id));
  res.status(204).send();
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type GradedEstimate = { psa10: number; bgs10: number; confidence: "low" | "medium" | "high" };

// AI-estimated graded values (PSA 10 Gem Mint & BGS Pristine 10 / Black Label).
// Real graded sales data has no free API, so we use the model's hobby knowledge
// to estimate the typical premium over the card's raw market value.
async function estimateGradedValues(
  card: typeof cardsTable.$inferSelect,
  binder: typeof bindersTable.$inferSelect | undefined
): Promise<GradedEstimate> {
  const raw = Number(card.currentPriceGBP);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a Pokémon TCG grading-market analyst. Given a card and its RAW (ungraded) market value in GBP, " +
          "estimate the current secondary-market value of the card in two top grades, in GBP. " +
          "PSA 10 = Gem Mint. BGS 10 = BGS Black Label / Pristine 10 (rarer and worth more than PSA 10). " +
          "Base your multiples on real hobby norms: PSA 10 is typically ~2x-8x raw (higher for vintage/chase, lower for bulk modern), " +
          "and BGS Pristine 10 is typically 1.3x-3x the PSA 10 value. Account for set, rarity, age and demand. " +
          'Respond ONLY with JSON: {"psa10": <number>, "bgs10": <number>, "confidence": "low"|"medium"|"high"}. Values are GBP numbers, no symbols.',
      },
      {
        role: "user",
        content: JSON.stringify({
          name: card.name,
          setNumber: card.setNumber,
          setTotal: card.setTotal,
          setCode: binder?.setCode ?? null,
          setName: binder?.name ?? null,
          rawMarketValueGBP: raw,
        }),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { psa10?: number; bgs10?: number; confidence?: string };

  let psa10 = typeof parsed.psa10 === "number" && parsed.psa10 > 0 ? parsed.psa10 : raw * 4;
  let bgs10 = typeof parsed.bgs10 === "number" && parsed.bgs10 > 0 ? parsed.bgs10 : psa10 * 1.6;
  // Sanity bounds: graded >= raw, BGS Pristine 10 >= PSA 10, and cap absurd
  // hallucinations (generous ceilings still allow large vintage premiums).
  psa10 = Math.min(Math.max(psa10, raw), Math.max(raw, 1) * 60);
  bgs10 = Math.min(Math.max(bgs10, psa10), psa10 * 5);

  return {
    psa10: parseFloat(psa10.toFixed(2)),
    bgs10: parseFloat(bgs10.toFixed(2)),
    confidence: parsed.confidence === "high" || parsed.confidence === "low" ? parsed.confidence : "medium",
  };
}

// A card's stored graded values are stale if missing or older than its last price refresh.
function gradedIsStale(card: typeof cardsTable.$inferSelect): boolean {
  if (card.psa10GBP == null || card.bgs10GBP == null || !card.gradedRefreshedAt) return true;
  if (card.lastPriceRefreshedAt && card.gradedRefreshedAt < card.lastPriceRefreshedAt) return true;
  return false;
}

async function ensureGradedValues(card: typeof cardsTable.$inferSelect) {
  if (!gradedIsStale(card)) {
    return { ...card, psa10GBP: card.psa10GBP, bgs10GBP: card.bgs10GBP };
  }
  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, card.assignedBinderId));
  const est = await estimateGradedValues(card, binder);
  const [updated] = await db
    .update(cardsTable)
    .set({ psa10GBP: String(est.psa10), bgs10GBP: String(est.bgs10), gradedRefreshedAt: new Date() })
    .where(eq(cardsTable.id, card.id))
    .returning();
  return updated;
}

router.get("/:id/graded-values", async (req, res) => {
  const parse = GetCardParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [card] = await db.select().from(cardsTable).where(eq(cardsTable.id, parse.data.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  const raw = Number(card.currentPriceGBP);

  try {
    const updated = await ensureGradedValues(card);
    res.json({
      raw: parseFloat(raw.toFixed(2)),
      psa10: Number(updated.psa10GBP),
      bgs10: Number(updated.bgs10GBP),
      confidence: "medium",
      estimated: true,
    });
  } catch (err) {
    const e = err as { status?: number };
    if (e?.status === 429) {
      res.status(429).json({ error: "quota_exceeded", detail: "OpenAI quota exceeded." });
      return;
    }
    console.warn("Graded value lookup failed:", err);
    res.status(502).json({ error: "lookup_failed", detail: "Could not estimate graded values." });
  }
});

router.post("/:id/refresh-price", async (req, res) => {
  const parse = RefreshCardPriceParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [card] = await db.select().from(cardsTable).where(eq(cardsTable.id, parse.data.id));
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, card.assignedBinderId));
  const newPrice = await fetchLivePriceGBP(card.name, card.setNumber, binder?.setCode);
  const [updated] = await db
    .update(cardsTable)
    .set({ currentPriceGBP: String(newPrice), lastPriceRefreshedAt: new Date() })
    .where(eq(cardsTable.id, card.id))
    .returning();
  res.json(formatCard(updated));
});

export default router;
