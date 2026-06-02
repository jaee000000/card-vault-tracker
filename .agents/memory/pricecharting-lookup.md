---
name: PriceCharting card lookup (PokéVault scanner)
description: How the AI card scanner prices/identifies cards, esp. Japanese ones, via PriceCharting + GPT-4o vision.
---

# PriceCharting lookup for the card scanner

PriceCharting's `search-products?q=...&type=prices` endpoint needs **no API token**. JSON `products[]` each have:
- `price1` = **ungraded / raw** price (matches the site's "Ungraded" column) — THIS is what we display.
- `price2` = PSA 9, `price3` = PSA 10 / grade 10. Do NOT use price3 for "raw" value.
**Why:** we shipped price3 by mistake once and a £2 card showed as £11. price1 is the raw value.
USD → GBP uses a flat `USD_TO_GBP` multiplier.

Query that works for Japanese sets: `"{name} {number} {pcKeyword} japanese"` then filter results whose
`productName` includes the name + `#number` and `consoleName` includes "japanese". `JP_SET_TO_PC` maps the
Japanese set code (e.g. `m2a` → `"mega dream"`) to PriceCharting's set keyword.

## AI vision is the weak link, not the lookup
GPT-4o frequently **guesses the Pokémon from the artwork instead of reading the printed name**, and misreads
small text (set code `m2a`→`sv3a`, number `224`→`204`). Real example: メガユキメノコex = "Mega Froslass ex"
(ユキメノコ=Froslass, ユキノオー=Abomasnow) was returned as "Abomasnow" because the snowy art looks similar.

Mitigations in place:
- Frontend sends **three images**: full frame + top-crop (top 45%, for the NAME) + bottom-crop (bottom 40%, for set code/number). Crops are upscaled 2× at JPEG q0.95 for legibility.
- Prompt forbids identifying from artwork; name MUST come from the printed top text. Keep "Mega" prefix and
  "ex/GX/V/VMAX" suffix exactly (PriceCharting names them e.g. "Mega Froslass ex").
- `baseName` strips a leading `Mega ` AND trailing suffix, else firstName becomes "Mega" and the English
  PokéTCG fallback breaks.
- PriceCharting has a fallback: if exact `#number` match fails (AI misread number/set), search name-only and
  pick the Japanese result whose `#number` is closest to what the AI read.

**How to apply:** when scanner accuracy complaints come in, the fix is almost always the prompt/crops (reading),
not the lookup. Verify a card's real price by querying PriceCharting directly and reading `price1`.

## Japanese scan: PriceCharting must run FIRST (Phase 0)
`lookupCard` in scan.ts: for Japanese sets (jpSet truthy), run `priceChartingLookup` BEFORE the English-equivalent phases and return immediately on a hit. Otherwise the English AR/secret-rare phases match an English same-species card and return its WRONG art + price.
**Why:** Mega Froslass ex (224/193, M2A) returned an English Froslass image + £10.25 until PriceCharting was reordered ahead of the English phases -> correct image + £4.88.

## PokeTCG quoted multi-word name search returns nothing
`name:"Mewtwo VMAX"` (quoted, multi-word) returns ZERO results from api.pokemontcg.io, even though the card exists. `name:mewtwo*` (wildcard on first word) works.
**How to apply:** In `findCardImage`, after a quoted full-name search comes back empty, fall back to `name:<firstWord>*` (pageSize ~150), then prefer the exact normalized variant (e.g. norm name === "mewtwovmax") before looser `namesMatch`, then sort by closest set total.

## Backfill route for missing card images
`POST /api/cards/backfill-images` (cards.ts) fills cards with null/empty image_url via `findCardImage`; only overwrites price when current <=0. Idempotent (skips rows that already have an image). Guarded in production by `x-admin-token` header === `ADMIN_TOKEN` env; open in dev for local seeding.
**Note:** seed/demo cards use fictional set names (Chaos Rising/CHR, Abyss Eye/ABY, M2a Mega Dream ex/M2A) with numbers that don't map to real cards, so matched art is best-effort.
