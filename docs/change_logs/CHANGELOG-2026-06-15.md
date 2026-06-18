# Changelog — June 15, 2026

## Branches: `looks-2026-06-15`, `easier-tournament-input-2026-06-15` (both merged to `main`)

**Context:** Two sessions. First a polish/correctness pass (`looks-…`), then a
setup-flow feature (`easier-tournament-input-…`). Commits `7366df9` and `4268c0c`.

---

## 1. Final standings now tie exactly like AES

**Problem:** our final overall ranks didn't match AES. For 2026 FAST Pre
Nationals (two 8-team brackets), AES showed a bottom rank of **15** with ties;
we showed **13**.

**Cause:** ties were computed from a fixed elimination-round formula
(`eliminationTiedRank`), which lumped *all four* quarterfinal losers together
at 5th (`1,2,3,3,5,5,5,5`). AES actually plays **consolation/placement
matches** that split them into 5th–6th and 7th–8th (`1,2,3,3,5,5,7,7`).

**Fix (`lib/tournament/final-standings.ts`):** `computeBracketPlaces()` now
derives finish places from **actual match results**:
- Coarse tier still comes from elimination depth (a finalist always outranks a
  semifinalist they never played).
- Within a tier, head-to-head results (transitive "winner beats loser") split
  teams whose order a match actually decided; teams no match separated stay tied.
- Refinement never crosses tiers, so a finalist can't be tied with a
  semifinalist.

Result: FAST now reads bottom rank **15** with the correct ties. Explicit-rank
events (e.g. Lone Star Regionals, which publish overall ranks via RankText) are
unaffected — that path is bypassed.

**Verified** across FAST, Lone Star Regionals, both SLC divisions, and both
ALSC2 divisions — no 1st/2nd tie regressions; one-hop/no-consolation brackets
degrade to the old behavior.

## 2. Readability / contrast

Dim text and faint outlines were hard to read on phones. Lightened one step,
staying within the zinc palette to avoid clashing: `text-zinc-500 → 400`,
`text-zinc-600 → 500`, card borders `zinc-800 → 700`. Applied to the tracker
and the setup page.

## 3. Search for a tournament (no more URL hunting)

You can now **search by tournament name** on the setup page; pasting an AES URL
still works as a fallback.

- **`/api/events?q=`** (new) — proxies AES's public event directory
  (`advancedeventsystems.com/api/events`). It's an OData endpoint, so we filter
  server-side (`$filter=contains(tolower(name),'…')`) instead of pulling the
  full ~8 MB list. CORS is closed on it, hence the server-side proxy. Min 2
  chars; results capped and ordered by start date.
- **`encodeEventId()` (`lib/aes.ts`)** — the directory returns a numeric
  `eventId` (e.g. `42465`), but the results API needs its token form. It is
  `base64("=" + id-padded-to-10 + "=") + "0"`. The trailing `0` is required —
  the clean base64 returns the SPA shell. Verified against several live events.
- **`/api/event-info`** extended to also return the division list, feeding a new
  division-picker step (auto-skipped when an event has one division).
- **`app/setup/page.tsx`** rewritten: search box (debounced) → event → division
  → team, with the paste-a-URL path kept.

## 4. Landing routes by setup state

The home page now renders a neutral splash until a saved tournament is
confirmed: an un-configured visitor goes straight to `/setup` without the
tracker flashing, and a configured one goes straight to their tournament. (The
redirect logic existed; this removed the half-rendered flash.)

## New AES API knowledge

- **Event directory:** `GET advancedeventsystems.com/api/events` is OData
  (`{value:[…]}`), ~8 MB unfiltered; supports `$filter`, `$orderby`, `$top`.
  Case-insensitive via `contains(tolower(name),'…')`. CORS closed → must proxy.
- **Results event token** = `base64("=" + numericEventId.padStart(10,'0') + "=") + "0"`.
