import { Router } from "express";
import { db, cardsTable, bindersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

function formatCard(c: typeof cardsTable.$inferSelect) {
  return {
    ...c,
    currentPriceGBP: Number(c.currentPriceGBP),
    createdAt: c.createdAt.toISOString(),
    lastPriceRefreshedAt: c.lastPriceRefreshedAt?.toISOString() ?? null,
  };
}

async function fetchMockPriceGBP(name: string, setNumber: number): Promise<number> {
  const seed = (name.length * setNumber * 17) % 5000;
  return parseFloat((1.5 + seed / 100).toFixed(2));
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

  const priceGBP = currentPriceGBP ?? (await fetchMockPriceGBP(name, setNumber));

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
  const newPrice = await fetchMockPriceGBP(card.name, card.setNumber);
  const [updated] = await db
    .update(cardsTable)
    .set({ currentPriceGBP: String(newPrice), lastPriceRefreshedAt: new Date() })
    .where(eq(cardsTable.id, card.id))
    .returning();
  res.json(formatCard(updated));
});

export default router;
