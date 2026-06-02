---
name: PokéVault card tracker
description: Durable gotchas for the Pokémon card tracker — pricing source, binder slot model, deep-linking
---

# Pricing lookup (Japanese cards)
- PriceCharting matches by **official English species name + #number**, NOT romaji. AI vision must return English names ("Mega Dragonite ex"), never romaji ("Mega Kairyu ex").
- Defense in depth: GPT prompt demands English species name AND a `ROMAJI_TO_EN` map + `normalizeSpeciesName()` in scan.ts runs before lookup and before returning to the client.
- **Why:** romaji names silently produce "Price N/A" because the search returns no match. Both layers needed — the model occasionally still emits romaji.
- **How to apply:** when a JP card shows no price, first check whether the species name reached PriceCharting in English; extend ROMAJI_TO_EN if a new romaji slips through.
- PriceCharting query shape: `"<English name> <number> <pcKeyword> japanese"`, USD price1 × 0.79 = GBP. JP set→keyword map (e.g. m2a → "mega dream") lives in scan.ts.

# Binder slot model
- A card occupies the slot equal to its **setNumber** (getCardForSlot matches c.setNumber === slotNumber).
- Secret-rare / alt-art cards can have setNumber > setTotal (e.g. 224/193). The grid must use `effectiveTotal = max(setTotal, maxCardNumber)` for page count, and render slots beyond setTotal only when a card occupies them — otherwise those cards are invisible.
- Known data quirk: nothing enforces unique setNumber per binder, so duplicates collapse to the first match (only matters for seeded demo dupes; not handled).

# Deep-linking to a slot
- Scanner navigates to `/binder/:id?slot=<setNumber>` after save; BinderView reads `?slot` via wouter `useSearch`, jumps page to floor((slot-1)/9), highlights via slot-pop animation.
- **Why one-shot:** the consume effect depends on `binder`, which changes identity on refetch/refocus. Without a `consumedSlotRef` guard keyed on the raw slot string, a background refetch yanks the user back to the slot page after they navigate away. Always clamp slot to [1, effectiveTotal].
