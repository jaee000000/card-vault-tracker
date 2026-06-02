import { Router } from "express";
import OpenAI from "openai";
import { db, cardsTable, bindersTable } from "@workspace/db";
import { eq, or, isNull } from "drizzle-orm";
import { findCardImage, priceChartingLookup } from "./scan";
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

export async function fetchLivePriceGBP(name: string, setNumber: number, setCode?: string): Promise<number> {
  const sc = setCode?.toLowerCase();
  try {
    const numStr = String(setNumber);
    // When a setCode is known, try the set-scoped query first so we don't
    // accidentally match a same-named card from a different (often English) set.
    const queries: string[] = [];
    if (sc) queries.push(`name:"${name}" number:${numStr} set.id:${sc}`);
    queries.push(
      `name:"${name}" number:${numStr}`,
      `name:"${name.split(" ")[0]}" number:${numStr}`,
    );

    for (const q of queries) {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=10&select=tcgplayer,cardmarket,name,number,set`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;

      const json = await res.json() as {
        data: Array<{
          set?: { id?: string };
          tcgplayer?: { prices?: Record<string, { market?: number }> };
          cardmarket?: { prices?: { averageSellPrice?: number } };
        }>;
      };
      const cards = json.data ?? [];
      if (!cards.length) continue;

      for (const card of cards) {
        // If we have a setCode, reject cards whose set ID doesn't match.
        // This prevents English set prices polluting Japanese-set cards.
        if (sc && card.set?.id) {
          const cardSet = card.set.id.toLowerCase();
          if (cardSet !== sc && !cardSet.includes(sc) && !sc.includes(cardSet)) continue;
        }

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

  // PokéTCG had no data — try PriceCharting (price1 = real ungraded market price)
  try {
    const pc = await priceChartingLookup(name, setNumber, sc);
    if (pc?.priceGBP && pc.priceGBP > 0) {
      console.log(`[price] pricecharting fallback: "${name}" £${pc.priceGBP}`);
      return pc.priceGBP;
    }
  } catch (err) {
    console.warn("PriceCharting price fetch failed:", err);
  }

  return 0;
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
  const { name, setNumber, setTotal, assignedBinderId, condition, currentPriceGBP, psa10GBP, bgs10GBP, imageUrl } = parse.data;

  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, assignedBinderId));
  if (!binder) {
    res.status(400).json({ error: "Binder not found" });
    return;
  }

  const priceGBP = currentPriceGBP ?? (await fetchLivePriceGBP(name, setNumber, binder.setCode));

  // If PSA 10 came from PriceCharting during scan, save it immediately.
  // Estimate BGS 10 at 1.6× PSA 10 — the AI eBay search refines it on next graded-values request.
  const resolvedPsa10 = psa10GBP ?? null;
  const resolvedBgs10 = bgs10GBP ?? (resolvedPsa10 ? parseFloat((resolvedPsa10 * 1.6).toFixed(2)) : null);

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
      psa10GBP: resolvedPsa10 != null ? String(resolvedPsa10) : null,
      bgs10GBP: resolvedBgs10 != null ? String(resolvedBgs10) : null,
      gradedRefreshedAt: resolvedPsa10 != null ? new Date() : null,
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

router.get("/collection", async (_req, res) => {
  const [cards, binders] = await Promise.all([
    db.select().from(cardsTable),
    db.select().from(bindersTable),
  ]);
  const binderMap = new Map(binders.map((b) => [b.id, b]));
  const result = cards
    .map((c) => {
      const formatted = formatCard(c);
      const binder = binderMap.get(c.assignedBinderId);
      return { ...formatted, binderName: binder?.name ?? null, binderSetCode: binder?.setCode ?? null };
    })
    .sort((a, b) => b.currentPriceGBP - a.currentPriceGBP);
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

type GradedEstimate = {
  psa10: number;
  bgs10: number;
  confidence: "low" | "medium" | "high";
  source: "pricecharting" | "web-search" | "ai-estimate";
};

// For web-search: only floor (graded >= raw); real prices have no meaningful ceiling.
// For AI fallback: also apply a ceiling to prevent hallucinated values (60× raw).
function clampGradedWebSearch(raw: number, psa10: number, bgs10: number): Pick<GradedEstimate, "psa10" | "bgs10"> {
  psa10 = Math.max(psa10, raw);
  bgs10 = Math.max(bgs10, psa10);
  return { psa10: parseFloat(psa10.toFixed(2)), bgs10: parseFloat(bgs10.toFixed(2)) };
}

function clampGradedAI(raw: number, psa10: number, bgs10: number): Pick<GradedEstimate, "psa10" | "bgs10"> {
  psa10 = Math.min(Math.max(psa10, raw), Math.max(raw, 1) * 60);
  bgs10 = Math.min(Math.max(bgs10, psa10), psa10 * 5);
  return { psa10: parseFloat(psa10.toFixed(2)), bgs10: parseFloat(bgs10.toFixed(2)) };
}

function extractJsonFromText(text: string): Record<string, unknown> {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const match = block.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

// Step 1: PriceCharting direct lookup (price2 = PSA 10 sale data — most accurate)
// Step 2: gpt-4o-search-preview live web search
// Step 3: gpt-4o knowledge-based estimate (fallback)
async function estimateGradedValues(
  card: typeof cardsTable.$inferSelect,
  binder: typeof bindersTable.$inferSelect | undefined
): Promise<GradedEstimate> {
  const raw = Number(card.currentPriceGBP);
  const cardDesc = [
    card.name,
    binder?.name ? `from set "${binder.name}"` : "",
    binder?.setCode ? `(${binder.setCode})` : "",
    `card ${card.setNumber}/${card.setTotal}`,
  ].filter(Boolean).join(" ");

  // --- Phase 0: PriceCharting (price2 = PSA 10, no AI needed) ---
  // Then do a targeted AI eBay search for BGS 10 specifically.
  try {
    const setCode = binder?.setCode?.toLowerCase();
    const pc = await priceChartingLookup(card.name, card.setNumber, setCode);
    if (pc?.psa10GBP && pc.psa10GBP > 0) {
      const psa10 = parseFloat(Math.max(pc.psa10GBP, raw).toFixed(2));
      let bgs10 = parseFloat((psa10 * 1.6).toFixed(2)); // default until eBay search resolves

      // AI eBay search for BGS 10 specifically (PriceCharting doesn't track BGS grades)
      try {
        const bgsResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(22000),
          body: JSON.stringify({
            model: "gpt-4o-search-preview",
            web_search_options: { search_context_size: "low" },
            messages: [
              {
                role: "user",
                content:
                  `Search eBay UK and eBay.com completed/sold listings for a BGS Pristine 10 or BGS Black Label graded Pokémon card: ${cardDesc}. ` +
                  `Also check mavin.io and 130point for BGS 10 sold prices. ` +
                  `The PSA 10 price is £${psa10} GBP. Convert any USD prices to GBP (1 USD = 0.79 GBP). ` +
                  `Reply ONLY with JSON, no extra text: {"bgs10_gbp": <number or null if not found>}`,
              },
            ],
          }),
        });
        if (bgsResp.ok) {
          const bgsData = await bgsResp.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
          if (!bgsData.error) {
            const content = bgsData.choices?.[0]?.message?.content ?? "";
            const parsed = extractJsonFromText(content) as { bgs10_gbp?: unknown };
            const bgs10Raw = typeof parsed.bgs10_gbp === "number" && parsed.bgs10_gbp > 0 ? parsed.bgs10_gbp : null;
            if (bgs10Raw) {
              bgs10 = parseFloat(Math.max(bgs10Raw, psa10).toFixed(2));
              console.log(`[graded] ebay-bgs: "${card.name}" BGS10=£${bgs10}`);
            }
          }
        }
      } catch (bgsErr) {
        console.warn("[graded] BGS eBay search failed, using PSA10×1.6 estimate:", (bgsErr as Error).message);
      }

      console.log(`[graded] pricecharting+ebay: "${card.name}" PSA10=£${psa10} BGS10=£${bgs10}`);
      return { psa10, bgs10, confidence: "high", source: "pricecharting" };
    }
  } catch (err) {
    console.warn("[graded] PriceCharting lookup failed, trying AI:", (err as Error).message);
  }

  // --- Phase 1: Live web search via gpt-4o-search-preview ---
  try {
    const searchResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: "gpt-4o-search-preview",
        web_search_options: { search_context_size: "low" },
        messages: [
          {
            role: "user",
            content:
              `Search for the current market price of a PSA 10 Gem Mint graded and BGS Pristine 10 / Black Label graded Pokémon card: ${cardDesc}. ` +
              `The raw ungraded market value is £${raw.toFixed(2)} GBP. ` +
              `Search eBay UK sold listings, mavin.io, 130point, or price aggregators for recent actual sold prices of this card graded PSA 10 and BGS 10. ` +
              `Convert any USD prices to GBP (1 USD = 0.79 GBP). ` +
              `Reply ONLY with a JSON object, no extra text: ` +
              `{"psa10_gbp": <number or null if not found>, "bgs10_gbp": <number or null if not found>, "confidence": "low"|"medium"|"high", "note": "<brief source summary>"}`,
          },
        ],
      }),
    });

    if (searchResp.ok) {
      const searchData = await searchResp.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (searchData.error) {
        console.warn("[graded] search model error:", searchData.error.message);
        throw new Error(searchData.error.message);
      }
      const content = searchData.choices?.[0]?.message?.content ?? "";
      const parsed = extractJsonFromText(content) as { psa10_gbp?: unknown; bgs10_gbp?: unknown; confidence?: unknown };

      const psa10Raw = typeof parsed.psa10_gbp === "number" && parsed.psa10_gbp > 0 ? parsed.psa10_gbp : null;
      const bgs10Raw = typeof parsed.bgs10_gbp === "number" && parsed.bgs10_gbp > 0 ? parsed.bgs10_gbp : null;

      if (psa10Raw) {
        // Use real web-search prices — no upper cap, just ensure graded >= raw
        const { psa10, bgs10 } = clampGradedWebSearch(raw, psa10Raw, bgs10Raw ?? psa10Raw * 1.6);
        const confidence = parsed.confidence === "low" ? "low" : parsed.confidence === "medium" ? "medium" : "high";
        console.log(`[graded] web-search: "${card.name}" PSA10=£${psa10} BGS10=£${bgs10}`);
        return { psa10, bgs10, confidence, source: "web-search" };
      }
    }
  } catch (err) {
    console.warn("[graded] web-search failed, falling back to knowledge estimate:", (err as Error).message);
  }

  // --- Fallback: gpt-4o knowledge-based estimate (capped to prevent hallucinations) ---
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a Pokémon TCG grading-market analyst. Given a card and its RAW market value in GBP, " +
          "estimate the PSA 10 and BGS Pristine 10 (Black Label) values in GBP. " +
          "PSA 10 is typically 2x–8x raw; BGS Pristine 10 is 1.3x–3x PSA 10. " +
          'Reply ONLY with JSON: {"psa10": <number>, "bgs10": <number>, "confidence": "low"|"medium"|"high"}',
      },
      {
        role: "user",
        content: JSON.stringify({ card: cardDesc, rawMarketValueGBP: raw }),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { psa10?: number; bgs10?: number; confidence?: string };
  const psa10ai = typeof parsed.psa10 === "number" && parsed.psa10 > 0 ? parsed.psa10 : raw * 4;
  const bgs10ai = typeof parsed.bgs10 === "number" && parsed.bgs10 > 0 ? parsed.bgs10 : psa10ai * 1.6;
  const { psa10, bgs10 } = clampGradedAI(raw, psa10ai, bgs10ai);
  const confidence: GradedEstimate["confidence"] = parsed.confidence === "high" ? "high" : parsed.confidence === "low" ? "low" : "medium";
  return { psa10, bgs10, confidence, source: "ai-estimate" };
}

// A card's stored graded values are stale if missing or older than its last price refresh.
function gradedIsStale(card: typeof cardsTable.$inferSelect): boolean {
  if (card.psa10GBP == null || card.bgs10GBP == null || !card.gradedRefreshedAt) return true;
  if (card.lastPriceRefreshedAt && card.gradedRefreshedAt < card.lastPriceRefreshedAt) return true;
  return false;
}

type EnsuredGraded = {
  card: typeof cardsTable.$inferSelect;
  confidence: "low" | "medium" | "high";
  source: "cached" | "pricecharting" | "web-search" | "ai-estimate";
};

async function ensureGradedValues(card: typeof cardsTable.$inferSelect): Promise<EnsuredGraded> {
  if (!gradedIsStale(card)) {
    return { card, confidence: "medium", source: "cached" };
  }
  const [binder] = await db.select().from(bindersTable).where(eq(bindersTable.id, card.assignedBinderId));
  const est = await estimateGradedValues(card, binder);
  const [updated] = await db
    .update(cardsTable)
    .set({ psa10GBP: String(est.psa10), bgs10GBP: String(est.bgs10), gradedRefreshedAt: new Date() })
    .where(eq(cardsTable.id, card.id))
    .returning();
  return { card: updated, confidence: est.confidence, source: est.source };
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
    const { card: updated, confidence, source } = await ensureGradedValues(card);
    res.json({
      raw: parseFloat(raw.toFixed(2)),
      psa10: Number(updated.psa10GBP),
      bgs10: Number(updated.bgs10GBP),
      confidence,
      source,
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
