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

## Production pricing workaround: live web search (gpt-4o-search-preview)
Because PriceCharting is blocked from prod (see below) and Japanese-only cards (e.g. Cynthia's Spiritomb M2A) aren't in PokéTCG, they showed "Price N/A" in production. Fix: `webSearchRawPriceGBP(name, setNumber, setTotal, setId)` in scan.ts uses OpenAI model `gpt-4o-search-preview` with `web_search_options` (raw fetch to /v1/chat/completions, NOT the SDK) to find the RAW ungraded GBP price from eBay sold/PriceCharting/mavin/130point. This model reaches the open web FROM PROD (OpenAI egress is allowed; it's the same model used for graded-values eBay search).
Wired as last-resort only (so it never slows cards already priced by PokéTCG/PriceCharting): lookupCard Phase 5 when English-twin price is 0, a new Phase 6 final fallback, and fetchLivePriceGBP (cards.ts) before returning 0. Note shown: "Price from live web search (sold listings)". 22s timeout; returns 0 on any failure.
**Why this and not a CORS/relay proxy:** free relays (allorigins/corsproxy/codetabs) ALSO get an empty body from PriceCharting — it blocks cloud/datacenter IPs generally, so no cloud-hosted relay works. The dev sandbox IP is allowed, which is why dev works.

## Production OFFICIAL-IMAGE workaround: live web search (gpt-4o-search-preview)
Same idea as the price workaround but for artwork. `webSearchOfficialImage(name, setNumber, setTotal, setId)` in scan.ts asks gpt-4o-search-preview for direct official card-art image URLs (pokemontcg.io, pokemon-card.com, tcgplayer, limitlesstcg, serebii, bulbapedia), extracts up to 3 URLs, then **validates each with a real GET** (`validateImageUrl`: resp.ok + content-type `image/*` + content-length ≥ 1000) and returns the FIRST that renders, else null.
**Why validate:** the model often returns plausible-but-dead URLs (e.g. a guessed limitlesstcg path that 404s). Since validation runs IN PROD, a pass also proves the URL is reachable/hot-linkable from the deployed egress IP — so cards never show a broken image. serebii.net card images are reliable & hot-linkable and were the working source in testing.
Wired last-resort only: findCardImage end, lookupCard Phase 5 (when image null) + Phase 6 (parallel with price), and the `/:id/hires-image` auto-heal endpoint (after tcgHiResLookup returns null). NOT in the create-time path — that uses a 4s race and web search needs ~20s, so new cards keep the scan photo and the detail-panel auto-heal upgrades them on open.
SSRF/wrong-source guard: webSearchOfficialImage only fetches/stores URLs whose host is in IMAGE_HOST_ALLOWLIST (images.pokemontcg.io, pokemon-card.com, tcgplayer.com, limitlesstcg.com, serebii.net, bulbagarden.net) — never arbitrary AI-supplied hosts/IPs. Candidates whose path contains the card number are tried first; all validated in parallel. serebii is the reliable hot-linkable source in practice; the model also emits dead limitlesstcg jp paths that 404 (validation rejects them).

## NEVER pick a card IMAGE *or PRICE* by closest set total — only exact name+number
Both the displayed thumbnail AND the price must come from an EXACT name + EXACT number twin. The old Phase 5 logic fell back to `sortBySetTotal(...)` when no exact-number twin existed, grabbing a DIFFERENT English card of the same Pokémon whose printedTotal was merely closest. For JP Rayquaza M2A 127/193 this showed Vivid Voltage "Amazing Burst" Rayquaza (total 185 ≈ 193) AND priced off it at £21.93 — but that's an expensive Amazing Rare; the real raw card is ~£1.60 ($2.12 on PriceCharting). A loose set-total match is wrong for BOTH art and money: same-species cards across sets vary wildly in rarity/price. If no exact-number twin: leave imageUrl null AND priceGBP 0, and let webSearchOfficialImage / webSearchRawPriceGBP fetch the real values (web search returned £1.58 for this card — correct).
**Why:** two user reports on the same Rayquaza M2A 127/193 scan — first wrong art, then wrong price (£21.93). **How to apply:** any English-equivalent path (lookupCard Phase 5, findCardImage, tcgHiResLookup) must require exact name+number for BOTH price and image; tie-break among exact-number matches by closest total, never a loose total-only fallback. The rarity-suffix/`hasSuffix` price heuristic was removed entirely.

## PriceCharting is UNREACHABLE from the production deployment (dev works)
In the published/deployed environment, requests to pricecharting.com return an empty body (blocked), so every `priceChartingLookup` silently fails (caught) and falls through to the PokéTCG phases. In dev it works fine. This means Japanese cards scanned in production CANNOT use Phase 0/4 (PriceCharting) — they fall to Phase 5.
**Why:** user reported "Price N/A" only on the published app for M4 Mega Greninja ex while dev priced it. Confirmed prod PriceCharting fetch returns 0 bytes.
**How to apply:** any pricing/image path that only works via PriceCharting will NOT work in production. Make Japanese cards degrade gracefully through PokéTCG (Phase 5). Don't assume a dev-verified PriceCharting fix works in prod.

## Phase 5 (English-equivalent fallback): one exact twin drives BOTH price and image
For Japanese cards that fall to Phase 5, both PRICE and IMAGE now come from the SAME single exact name+number twin (`twin = sortBySetTotal(numMatches)[0]`, where numMatches require exact normalized name AND exact number). If that twin has a price, use `bestPrice(twin)` (note: JP → "price estimate from English equivalent", EN → null). If the twin has no price or no twin exists, fall to webSearchRawPriceGBP for price and webSearchOfficialImage for art — these two run in `Promise.all` (parallel) only for whatever the twin couldn't supply. priceNote ladder: twin estimate → "Price from live web search (sold listings)" → "Japanese card — not in price database" (JP, web search also empty) → null.
**Why:** the previous design priced off a *different* loose set-total English card (rarity-suffix heuristic), which gave £21.93 for a ~£1.60 Rayquaza. A twin that matches on both name AND number is the only English card whose price is a fair proxy; anything looser is a different card.

## Early phases must NOT short-circuit to "Price N/A" when the English twin has price 0
lookupCard's early English-equivalent phases (Phase 1 set.id+number, Phase 2 AR/secret-rare name+closest-number, Phase 3 number+name) historically returned `bestPrice(match)` + jpNote immediately. Many PokéTCG cards (esp. AR/secret-rare twins) have `bestPrice()===0`, so a JP card that matched an English twin only for the IMAGE returned priceGBP 0 and exited BEFORE the Phase 5/6 webSearchRawPriceGBP fallback → user saw "Price N/A". Real case: Sliggoo 093/83 M4 AR — English Sliggoo AR matched for art but priced 0; web search would have found £3.32.
**Fix:** a `withLivePrice(priceGBP, imageUrl)` helper inside lookupCard — if priceGBP>0 return as-is (jpNote for jpSet), else call webSearchRawPriceGBP and return that (note "Price from live web search (sold listings)" or "Japanese card — not in price database"), keeping the image already found. ALL early-phase returns (Phases 1, 2, 3 incl. both namedMatch and namedClose) route through it. Web search only fires when price is 0, so priced cards keep their speed.
**Why:** "perfectly match the price to every card scanned" — no phase may exit with price 0 while a live price is obtainable. **Watch:** when adding a new early phase, route its return through withLivePrice too, or it reintroduces the N/A short-circuit (the architect caught Phase 2 being missed on the first pass).

## Trainer's Pokémon cards — the possessive prefix MUST be captured
JP "Trainer's Pokémon" cards print a trainer name in possessive form (ending in の = "'s") BEFORE the Pokémon, e.g. シロナのミカルゲ = "Cynthia's Spiritomb" (シロナ=Cynthia, ミカルゲ=Spiritomb). The AI drops the prefix and returns just "Spiritomb", which then matches a DIFFERENT real card on PriceCharting → wrong art + wrong price. Real case: シロナのミカルゲ m2a 208/193 was returned as plain "Spiritomb" sv2a 203/165 (a real Clay Burst card).
**Fix:** prompt now lists trainer translations (シロナ→Cynthia, カスミ→Misty, サカキ→Giovanni, ナンジャモ→Iono, マリィ→Marnie, リーリエ→Lillie, ハウ→Hau, グズマ→Guzma, アカギ→Cyrus, N→N) and requires "{Trainer}'s {Pokémon}".
**Why it's enough:** PriceCharting lists these as e.g. "Cynthia's Spiritomb #208" (Mega Dream ex). The name filter (`productName.includes(name)`) then excludes plain "Spiritomb"; even with a misread number/set the name-only fallback picks the closest-numbered "Cynthia's Spiritomb". m2a = "mega dream" in JP_SET_TO_PC.
**Caveat:** for these JP-only cards, baseName/firstName becomes "Cynthias" so the English-equivalent (PokéTCG) phases can't match — fine in dev (PriceCharting works) but in prod (PriceCharting blocked) they get no art, just the scan photo (never wrong art).

## AI misreads Japanese "m4" as English "xy4"
GPT-4o reads the Japanese M-series set code "m4" as "xy4". Fixed two ways: prompt explicitly says m-series start with 'm' not 'xy' ("m4" ≠ "xy4"), AND a code-level SET_ID_FIXES map rewrites xy4→m4 ONLY when setTotal ≠ 119 (real XY4 Phantom Forces size). 
**Why:** mismatch between reported setTotal and the real English set size is the only safe signal it's actually the JP set. Do NOT add speculative xy1/xy2/xy3 entries — their totals were guessed wrong and would misclassify real English XY cards.

## Same image-resolution process for EVERY scanned card
Two layers ensure every card ends up with real card art, not the user's scan photo:
1. CREATE time (POST /api/cards): if the incoming imageUrl is NOT a card-art host (scrydex/pokemontcg/pricecharting) — i.e. it's the cropped scan-photo data: URI or null — the server runs tcgHiResLookup(name, setNumber) and uses the result if found. It's wrapped in a 4s Promise.race timeout so an unresolvable card never stalls the save; on timeout it keeps the scan photo.
2. VIEW time (CardDetailPanel): opening a card whose stored image host is NOT a card-art host auto-calls GET /api/cards/:id/hires-image (same tcgHiResLookup), persists, then invalidates queries to re-render. This heals cards saved before the create-time fix.
**Why:** the scan's lookupCard already returns proper art for most cards, but when it returns null the frontend saves the user's photo; these two layers upgrade those.
**Watch:** tcgHiResLookup has a base-name+number fallback with no set constraint → small wrong-art risk for Japanese-only cards with no English twin (an unrelated English card of same number could match). Acceptable tradeoff; bound by the 4s timeout at create.
