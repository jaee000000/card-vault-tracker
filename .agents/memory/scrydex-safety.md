---
name: Scrydex image URL safety
description: Why you must never guess scrydex URLs from set_number, and the correct Ascended Heroes mapping
---

## Rule: Never guess scrydex URLs from stored set_number

Scrydex (images.scrydex.com) hosts Japanese Pokémon card images but its internal card numbering does NOT match the physical Japanese card number stored in our DB. A HEAD request to a guessed URL returns 200 OK even for a completely wrong card — there is no reliable way to detect a mismatch via HTTP.

**Why:** The user's cards are from the Japanese "Ascended Heroes" set (scrydex code `me2pt5`). Their physical card numbers (198, 206, 213, 224) are the Japanese set numbering, which differs from the English/scrydex numbering (223, 239, 250, 275). Guessing `me2pt5-206` for Dugtrio returns a Team Rocket item card, not Dugtrio.

## Confirmed mapping: Japanese M2A (Ascended Heroes, me2pt5)

Japanese set: M2A, set_total=193, special arts numbered 194+

| DB id | Name | Japanese # | Correct scrydex URL |
|-------|------|-----------|---------------------|
| 24 | Numel | 198 | me2pt5-223 |
| 26 | Rotom (Fan Rotom) | 213 | me2pt5-250 |
| 27 | Mega Dragonite ex | 126 | me2pt5-152 |
| 28 | Dugtrio (Team Rocket's) | 206 | me2pt5-239 |
| 29 | Mega Froslass ex | 224 | me2pt5-275 |
| 25 | Ampharos | 29 | me4-29 (different set: M4) |

## How to apply

- Only use a scrydex URL when: (a) PriceCharting's API returns it directly in the product image field, or (b) you know the exact verified mapping (as above).
- Never construct scrydex URLs programmatically from stored set_number.
- `tcgHiResLookup()` in cards.ts must only match cards by exact number — name-only fallback returns wrong English cards for Japanese sets.
- The `upgrade-images` endpoint and `backfill-images` endpoint are safe as long as `tcgHiResLookup` requires exact number match.
