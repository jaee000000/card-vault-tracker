---
name: Multi-tenant per-user scoping audit
description: When adding per-user isolation, audit EVERY query — including :id action sub-routes and shared helpers — not just list/CRUD.
---

When retrofitting per-user (per-tenant) isolation onto an existing route set, the obvious list and CRUD handlers get scoped by `userId`, but it's easy to miss:

- Auxiliary `:id`-based action endpoints (e.g. `/:id/graded-values`, `/:id/refresh-price`, `/:id/hires-image`) that fetch/update a record by id alone → IDOR (any authed user reads/mutates another user's row by guessing the id).
- Shared helper functions that `UPDATE ... WHERE id = ?` without a tenant predicate — pass `userId` in and add `eq(table.userId, userId)` to both the lookup and the update.

**Why:** In the PokéVault Clerk multi-tenant retrofit, the first pass scoped all list/CRUD routes but left three card action endpoints + the `ensureGradedValues` helper querying by id only. Architect code review caught the IDORs; curl/screenshot testing did not.

**How to apply:** After scoping, grep every `eq(<table>.id` and `from(<table>)` in the route dir and confirm each is paired with a `userId` predicate (or derives its id from an already-userId-scoped row, e.g. a binder lookup using a card you already verified belongs to the user). Then run the testing skill with `testClerkAuth: true` to verify cross-user isolation programmatically (Clerk UI sign-up hits a Cloudflare challenge otherwise).
