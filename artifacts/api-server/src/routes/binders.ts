import { Router } from "express";
import { db, bindersTable, cardsTable, insertBinderSchema } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateBinderBody,
  UpdateBinderBody,
  GetBinderParams,
  UpdateBinderParams,
  DeleteBinderParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (_req, res) => {
  const binders = await db.select().from(bindersTable).orderBy(bindersTable.createdAt);
  res.json(
    binders.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const parse = CreateBinderBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { name, setCode, setTotal, coverImageUrl } = parse.data;
  const [binder] = await db
    .insert(bindersTable)
    .values({ name, setCode, setTotal, coverImageUrl: coverImageUrl ?? null })
    .returning();
  res.status(201).json({ ...binder, createdAt: binder.createdAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const parse = GetBinderParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { id } = parse.data;
  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, id));
  if (!binder) {
    res.status(404).json({ error: "Binder not found" });
    return;
  }
  const cards = await db.select().from(cardsTable).where(eq(cardsTable.assignedBinderId, id)).orderBy(cardsTable.setNumber);
  res.json({
    ...binder,
    createdAt: binder.createdAt.toISOString(),
    cards: cards.map((c) => ({
      ...c,
      currentPriceGBP: Number(c.currentPriceGBP),
      createdAt: c.createdAt.toISOString(),
      lastPriceRefreshedAt: c.lastPriceRefreshedAt?.toISOString() ?? null,
    })),
  });
});

router.patch("/:id", async (req, res) => {
  const parse = UpdateBinderParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const bodyParse = UpdateBinderBody.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: bodyParse.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (bodyParse.data.name !== undefined) updates.name = bodyParse.data.name;
  if (bodyParse.data.coverImageUrl !== undefined) updates.coverImageUrl = bodyParse.data.coverImageUrl;
  const [updated] = await db.update(bindersTable).set(updates).where(eq(bindersTable.id, parse.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Binder not found" });
    return;
  }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const parse = DeleteBinderParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(bindersTable).where(eq(bindersTable.id, parse.data.id));
  res.status(204).send();
});

export default router;
