import { Router } from "express";
import { db, bindersTable, cardsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { GetBinderStatsParams } from "@workspace/api-zod";

const router = Router();

router.get("/vault", async (req, res) => {
  const userId = req.userId!;
  const [vaultRow] = await db
    .select({
      totalValueGBP: sql<string>`COALESCE(SUM(${cardsTable.currentPriceGBP}), 0)`,
      totalCards: sql<number>`COUNT(${cardsTable.id})::int`,
    })
    .from(cardsTable)
    .where(eq(cardsTable.userId, userId));

  const binders = await db
    .select({
      id: bindersTable.id,
      setTotal: bindersTable.setTotal,
      scannedCards: sql<number>`COUNT(${cardsTable.id})::int`,
    })
    .from(bindersTable)
    .leftJoin(cardsTable, eq(cardsTable.assignedBinderId, bindersTable.id))
    .where(eq(bindersTable.userId, userId))
    .groupBy(bindersTable.id, bindersTable.setTotal);

  const completedSets = binders.filter((b) => Number(b.scannedCards) >= b.setTotal).length;

  const binderCounts: Record<number, number> = {};
  for (const b of binders) binderCounts[b.id] = Number(b.scannedCards);

  res.json({
    totalValueGBP: parseFloat(Number(vaultRow.totalValueGBP).toFixed(2)),
    totalCards: Number(vaultRow.totalCards),
    completedSets,
    totalBinders: binders.length,
    binderCounts,
  });
});

router.get("/binder/:id", async (req, res) => {
  const userId = req.userId!;
  const parse = GetBinderStatsParams.safeParse({ id: Number(req.params.id) });
  if (!parse.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { id } = parse.data;

  const [binder] = await db
    .select()
    .from(bindersTable)
    .where(and(eq(bindersTable.id, id), eq(bindersTable.userId, userId)));
  if (!binder) {
    res.status(404).json({ error: "Binder not found" });
    return;
  }

  const [statsRow] = await db
    .select({
      scannedCards: sql<number>`COUNT(${cardsTable.id})::int`,
      totalValueGBP: sql<string>`COALESCE(SUM(${cardsTable.currentPriceGBP}), 0)`,
    })
    .from(cardsTable)
    .where(and(eq(cardsTable.assignedBinderId, id), eq(cardsTable.userId, userId)));

  const scannedCards = Number(statsRow.scannedCards);
  const completionPercent = binder.setTotal > 0 ? parseFloat(((scannedCards / binder.setTotal) * 100).toFixed(1)) : 0;

  res.json({
    binderId: binder.id,
    binderName: binder.name,
    totalCards: binder.setTotal,
    scannedCards,
    completionPercent,
    totalValueGBP: parseFloat(Number(statsRow.totalValueGBP).toFixed(2)),
  });
});

export default router;
