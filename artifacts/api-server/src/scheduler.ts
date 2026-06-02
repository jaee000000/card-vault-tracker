import { db, cardsTable, bindersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchLivePriceGBP } from "./routes/cards";
import { logger } from "./lib/logger";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STAGGER_MS = 2000;                          // 2 s between each card
const MIN_AGE_MS = 4 * 60 * 60 * 1000;           // skip if refreshed < 4 h ago
const STARTUP_DELAY_MS = 60 * 1000;              // wait 60 s after boot

async function refreshAllPrices(): Promise<void> {
  logger.info("[scheduler] price refresh started");
  try {
    const cards = await db.select().from(cardsTable);
    const binders = await db.select().from(bindersTable);
    const binderMap = new Map(binders.map((b) => [b.id, b.setCode]));

    const now = Date.now();
    let updated = 0;
    let skipped = 0;

    for (const card of cards) {
      try {
        const lastRefresh = card.lastPriceRefreshedAt?.getTime() ?? 0;
        if (now - lastRefresh < MIN_AGE_MS) {
          skipped++;
          continue;
        }

        const setCode = binderMap.get(card.assignedBinderId) ?? undefined;
        const newPrice = await fetchLivePriceGBP(card.name, card.setNumber, setCode);

        if (newPrice > 0) {
          await db
            .update(cardsTable)
            .set({ currentPriceGBP: String(newPrice), lastPriceRefreshedAt: new Date() })
            .where(eq(cardsTable.id, card.id));
          logger.info({ name: card.name, price: newPrice }, "[scheduler] card updated");
          updated++;
        }
      } catch (err) {
        logger.warn({ cardId: card.id, err }, "[scheduler] failed to update card price");
      }

      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }

    logger.info({ updated, skipped }, "[scheduler] price refresh complete");
  } catch (err) {
    logger.error({ err }, "[scheduler] refresh run failed");
  }
}

export function startPriceScheduler(): void {
  setTimeout(() => {
    void refreshAllPrices();
    setInterval(() => void refreshAllPrices(), REFRESH_INTERVAL_MS);
  }, STARTUP_DELAY_MS);

  logger.info(
    { delayMs: STARTUP_DELAY_MS, intervalHours: REFRESH_INTERVAL_MS / 3600000 },
    "[scheduler] price auto-refresh scheduled"
  );
}
