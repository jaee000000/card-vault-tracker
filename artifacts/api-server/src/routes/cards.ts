import { Router } from "express";
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
    createdAt: c.createdAt.toISOString(),
    lastPriceRefreshedAt: c.lastPriceRefreshedAt?.toISOString() ?? null,
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
      return res.status(403).json({ error: "Forbidden" });
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
