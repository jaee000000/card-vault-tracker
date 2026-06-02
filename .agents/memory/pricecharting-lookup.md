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
