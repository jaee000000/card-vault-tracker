---
name: Scrydex image URL safety
description: Why you must never construct scrydex URLs by guessing from set_number
---

Scrydex (images.scrydex.com) hosts Japanese Pokémon card images but its internal card numbering does NOT match the physical card number stored in our DB. For example, the M2A set uses scrydex code "me2pt5", but me2pt5-206 returns a Team Rocket item card — not Dugtrio at card number 206.

**Why:** Scrydex organises cards differently from the physical Japanese set numbering. A HEAD request to a guessed URL returns 200 OK even for the wrong card, so there is no reliable way to detect a mismatch.

**How to apply:**
- Only use a scrydex URL when PriceCharting's API returns it directly in the product image field. Those URLs are verified to point to the correct card.
- Never construct `images.scrydex.com/pokemon/{setCode}-{setNumber}/large` programmatically.
- The `tcgHiResLookup()` function in cards.ts must also only match cards by exact number, never by name alone — a name-only match returns wrong English cards for Japanese cards.
