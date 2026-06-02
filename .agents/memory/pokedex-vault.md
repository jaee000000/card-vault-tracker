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

# Set lookup for auto-creating binders
- `GET /api/scan/set-info?setId=&setTotal=` resolves {name,setCode,setTotal}. Priority: JP_SET_TO_PC keyword (real JP set name, e.g. m2a→"Mega Dream") → PokéTCG /v2/sets (via JP_TO_EN equivalence) → fallback "Set <CODE>"/"<n>-Card Set".
- Binder pockets = binder.setTotal. Auto-created binders MUST use the scanned printed total so pocket count matches the set (secret rares beyond total still get a slot via effectiveTotal in BinderView).
- Scanner auto-binder match heuristic: existing binder by setCode first, then setTotal; if none, prefill the new-binder form from set-info so one tap creates a correctly-sized binder.

# Scan animation is narrated, not real phases
- The AI identify is ONE API call. The 3-pass UI (name → set/number → artwork) is purely visual: scanPhase state driven by timers, with a MIN_SCAN_MS floor so a fast response still shows all passes. Don't mistake it for 3 separate backend calls.

# Graded values (PSA 10 / BGS Pristine 10) — live web-search prices
- `GET /api/cards/:id/graded-values` first tries `gpt-4o-search-preview` (via raw `fetch()` to `/v1/chat/completions`, NOT OpenAI SDK — SDK types don't support the model). Returns `{raw, psa10, bgs10, confidence, source}` where source is `"web-search" | "ai-estimate" | "cached"`.
- Web-search path: NO upper cap (real prices can be 100×+ raw for rare cards). Only floor applied: psa10 >= raw, bgs10 >= psa10.
- AI fallback path (when search fails or returns no price): standard gpt-4o with `response_format: json_object`; caps at raw×60 / psa10×5 to prevent hallucinations.
- `gpt-4o-search-preview` uses `web_search_options: {search_context_size: "low"}`. Does NOT support `response_format: json_object` — must use `extractJsonFromText()` to parse JSON from prose.
- `source` field is now tracked directly in `GradedEstimate` (not inferred from confidence level). UI shows "Live Price" badge for web-search, "AI Estimate · <conf>" for fallback.
- Values cached in `psa10_gbp`, `bgs10_gbp`, `graded_refreshed_at` columns; stale if older than `last_price_refreshed_at`.
- CardDetailPanel fetches on sheet open via plain fetch (AbortController for cancellation). Same relative `/api/...` pattern.
