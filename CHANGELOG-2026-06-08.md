# Changelog — June 8, 2026

## Branch: `feature/bracket-paths-ranking`

---

## 1. Fixed Bracket Path Detection (was showing "TBD")

**Problem:** Bracket paths showed "TBD" for the FAST Pre Nationals tournament because the bracket team text format changed from `1st-P5` to `1st-R1 D1 Pool 1  (1)`.

**Root cause:** The old `findBracketForTeamOrTag()` function only matched the short `Nth-PX` format. AES uses different formats across tournaments.

**Fix:** Replaced with `parsePoolRef()` that handles 5 pattern families:

| Pattern | Example | Tournament |
|---------|---------|-----------|
| Long format | `1st-R1 D1 Pool 1  (1)` | FAST Pre Nationals |
| Short format | `2nd-P5` | Lone Star Regionals |
| Place format | `1st Place Pool 2` | (future-proofing) |
| Reverse format | `Pool 1 - 1st` | (future-proofing) |
| Broad fallback | Any text with ordinal + "Pool"/"P" + number | Catch-all |

**Two-tier strategy:**
- Before pool play: Parse pool-reference text from bracket leaf nodes → map to brackets
- After pool play: Match actual team names in bracket tree → find which bracket they're in

---

## 2. Full Bracket Tree Display

**Problem:** Only first-round matchups were shown. User wanted the entire bracket structure mapped out.

**Fix:** Walk each bracket's tree (Roots → TopSource/BottomSource) collecting matches at each depth level, then organize into named rounds:

- **Quarterfinals** (depth 2) — all 4 first-round games with 8 teams
- **Semifinals** (depth 1) — Winner of Match X vs Winner of Match Y
- **Finals** (depth 0) — Championship match
- **Placement** (remaining roots) — Loser matchups for 5th-8th place

Round names are derived dynamically from tree depth, not hardcoded.

---

## 3. Ranking Predictions Per Bracket

**Problem:** No indication of what overall finish a bracket leads to.

**Fix:** `bracketFinishRanges` computed from last day's brackets using `FutureRoundMatches` count:
- Gold Bracket → Finish: 1st – 8th overall
- Silver Bracket → Finish: 9th – 16th overall

Displayed in the bracket header with emerald highlight.

---

## 4. Frontend Section Reorder

**Before:** Pool Standings → Bracket Paths → Matches → Work → Active Bracket

**After:** Pool Standings → Pool Play (matches) → Work → Bracket Play (full tree) → Active Bracket → Final Standings

---

## 5. Pool-to-Bracket Mapping

Shows how pool results feed into brackets:
- "Our pool → 1st in Pool (seed 1), 2nd in Pool (seed 4), 3rd in Pool (seed 5)"
- Matches involving our pool positions highlighted in yellow

---

## 6. Cross-Origin Dev Fix

**Problem:** Accessing dev server via `127.0.0.1` instead of `localhost` caused Next.js to block HMR WebSocket connections, preventing client-side JS from working.

**Fix:** Added `allowedDevOrigins: ['127.0.0.1', 'localhost']` to `next.config.ts`.

---

## Files Changed

- `app/api/tournament/route.ts` — Rewrote section 8 (bracket paths): `parsePoolRef()`, `getLeafMatchups()`, `walkTree()`, `formatTeamDisplay()`, `bracketTrees`, removed old `findBracketForTeamOrTag()`
- `app/page.tsx` — New `BracketRound`/`BracketRoundMatch` interfaces, reordered sections, full bracket tree rendering
- `next.config.ts` — Added `allowedDevOrigins`

---

## Verified Working

| Tournament | Teams | Bracket Format | Status |
|-----------|-------|---------------|--------|
| FAST Pre Nationals | 16 | Gold/Silver with seeds | ✅ Full tree + predictions |
| Lone Star Regionals | 64 | Challenge + Sunday brackets | ✅ Backwards compatible |
| Salt Lake City Showdown | 62 | Cross brackets → Gold/Silver | ✅ Final standings + tied ranks |
| adidas Lone Star Classic 2 | 123 | Multi-tier brackets | ✅ Backwards compatible |
