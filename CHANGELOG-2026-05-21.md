# Lone Star Tracker — Full Build Spec + Changes (May 21, 2026)

---

## What This App Is

A **Next.js (App Router)** web app that shows a focused, mobile-first dashboard for a single youth volleyball team competing in AES (Advanced Event Systems) tournaments. It's deployed to Netlify from the `main` branch.

The user configures a team code, event ID, and division ID via a `/setup` page. The main page (`/`) then auto-refreshes every 90 seconds and shows everything that team needs to know: pool standings, bracket path predictions, match results, bracket play, and final standings.

---

## Tech Stack

- **Framework:** Next.js 14+ with App Router (TypeScript)
- **Frontend:** React, TailwindCSS, mobile-first dark theme (zinc-900 backgrounds, yellow accents for "our team")
- **Backend:** Next.js API route at `app/api/tournament/route.ts`
- **Data source:** AES public API at `https://results.advancedeventsystems.com`
- **Deployment:** Netlify, auto-deploys from `main` branch on GitHub (`phoenix06sa/tstat`)

---

## AES API Details

**Base URL:** `https://results.advancedeventsystems.com`

**Required headers for all requests:**
```
accept: application/json, text/plain, */*
origin: https://results.advancedeventsystems.com
referer: https://results.advancedeventsystems.com/
user-agent: Mozilla/5.0 ...
```

**Key endpoints:**
- `GET /api/event/{eventId}` — Event metadata (Name, StartDate, EndDate)
- `GET /api/event/{eventId}/division/{divisionId}/plays/{date}` — All plays for a date (pools + brackets). Date format: `YYYY-MM-DD`

**Data model:**
- Each "play" has `PlayType`: 0 = pool, 1 = bracket
- Pools have `Teams[]` with `TeamCode`, `TeamName`, `TeamText`, `FinishRank`, match/set W-L stats
- Pools have `Matches[]` with `FirstTeamText`, `SecondTeamText`, `Sets[]`, `HasScores`, `Court`, `ScheduledStartDateTime`, `WorkTeamText`
- Brackets have `Roots[]` (match tree), `FutureRoundMatches[]` (ranked results with `RankText`), `FullName`, `ShortName`
- Bracket match tree: each node has `Match` (with team texts, scores), `TopSource`, `BottomSource` (child nodes), `Tag` (reference label)
- `TeamText` format varies: `"TeamName (LocCode)"` or `"TeamName (LocCode) (OverallRank)"`
- `RankText` format: `"N - TeamName (LocCode)"` or `"N - TeamName (LocCode) (OverallRank)"`

**Tournament structures vary — the app must handle all generically:**
- **2-day:** Pool play + Challenge Brackets + Final Brackets all on Day 1-2 (e.g., Lone Star Regionals)
- **3-day:** Pool play Day 1, Cross/Intermediate Brackets Day 2, Final Brackets Day 3 (e.g., Salt Lake City Showdown)
- **Direct-to-final:** Pool play → teams go straight to final brackets with no intermediate step (e.g., adidas Lone Star Classic 2)

---

## API Response Shape

The backend route (`GET /api/tournament?team={code}&event={eventId}&division={divisionId}`) returns:

```typescript
{
  teamCode: string;          // e.g. "g14askyl2ls"
  teamName: string;          // e.g. "Austin Skyline 14 Black"
  event: string;             // event name
  division: string;          // division name
  poolName: string;          // e.g. "Round 1 Group 1 Pool 5"
  poolCourt: string;         // court name
  poolStandings: PoolStanding[];  // teams in our pool with W-L, rank
  matches: PoolMatch[];      // ALL our matches (pool + bracket) chronologically
  workAssignments: WorkAssignment[];
  futurePaths: FuturePath[];     // where each pool finish rank leads
  activeBracket: ActiveBracket | null;  // round-by-round bracket view
  finalStandings: FinalStanding[];      // overall tournament standings
  debug: object;
}
```

---

## Frontend Page Layout (top to bottom)

1. **Header** — Event name, division, team name
2. **Pool Standings** — Table: team name, match W-L, set W-L, finish rank
3. **Bracket Paths** — One card per pool position showing where that rank goes: intermediate bracket name, court/time, opponent, and Win/Lose destination predictions with finish ranges
4. **Matches** — Grouped by date, each card shows opponent, time, court, Pool/Bracket badge, set scores, WIN/LOSS badge
5. **Work Assignments** — Date, time, court
6. **Active Bracket** — Round-by-round bracket view with resolved winners
7. **Final Standings** — Overall rank (with tied indicator), team name, bracket name
8. **Footer** — Team code, division, auto-refresh note

**Styling rules:** Yellow border/highlight for "our team" cards. Green for wins, red for losses. Star (★) prefix on our team name. Dark zinc theme throughout.

---

## Three Reference Tournaments for Testing

- **Salt Lake City Showdown** (SLC): event=`PTAwMDAwNDIwNDA90`, division=`207190` — 3-day, 62 teams, Cross Brackets → final brackets, NO explicit overall ranks in RankText
- **Lone Star Regionals** (LSR): event=`PTAwMDAwNDEyNDA90`, division=`195174` — 2-day, 64 teams, Challenge Brackets → final brackets, HAS explicit overall ranks in RankText like `(27)`
- **adidas Lone Star Classic 2** (ALSC2): event=`PTAwMDAwMzY5Njk90`, division=`171484` — 3-day, 123 teams, pool → direct final brackets (no intermediate bracket step)

Team code: `g14askyl2ls` (Austin Skyline 14 Black)

---

## Critical Implementation Details

These are the non-obvious details that took debugging to get right. If rebuilding from scratch, implement these from the start.

### Backend Processing Pipeline (route.ts)

The API route does the following steps in order:

1. **Fetch event metadata** — Get StartDate/EndDate from `/api/event/{eventId}`
2. **Generate date range** — Create array of `YYYY-MM-DD` strings from StartDate to EndDate inclusive
3. **Fetch plays for all days** — Hit `/api/event/{eventId}/division/{divisionId}/plays/{date}` for each date. Store as `allDaysPlays[]` array of `{ date, plays }`.
4. **Find our team's pool** — Scan all PlayType=0 plays across all days, find the first pool containing our `teamCode` in its `Teams[]` array.
5. **Extract pool standings** — From the pool's Teams array: team name, match W-L, set W-L, finish rank, tiebreaker info.
6. **Extract matches** — From the pool's Matches array: find matches involving our team, extract opponent, scores, court, time, work team. Also scan bracket plays for matches involving our team. Sort chronologically. Tag each as `isPoolPlay` true/false.
7. **Extract work assignments** — Find matches where `WorkTeamText` matches our team name.
8. **Build bracket paths (futurePaths)** — For each pool finish rank (1st through last), find which bracket they go to by searching all brackets for the rank tag (e.g., `"1st-P5"`) or by team name. Then trace through intermediate brackets to find Win/Lose final destinations.
9. **Build active bracket view** — Find the bracket play containing our team. Walk the match tree to extract all matches, resolve "Winner of..." chains, organize into rounds.
10. **Calculate final standings** — Parse RankText from the last day's bracket FutureRoundMatches. Apply elimination tied ranking with tier grouping.

### Key Helper Functions

- **`aes(path)`** — Fetch wrapper with required headers, 60s revalidation, null on failure
- **`stripLocationCode(name)`** — Strip trailing `(XX)` 2-letter code: regex `/\s*\([A-Z]{2}\)\s*$/`
- **`stripAllSuffixes(name)`** — Strip ALL trailing `(...)` groups: regex `/(\s*\([^)]+\))+\s*$/`. Needed because same team has different rank suffixes in pool vs bracket data.
- **`extractAllSources(play)`** — Walk a bracket's Roots tree recursively, collect all FirstTeamText/SecondTeamText/Tag values into a Set
- **`findBracketForTeamOrTag(searchText)`** — Search all brackets across all days for a team name or tag. Uses 4 comparison methods: exact, includes, stripLocationCode, stripAllSuffixes.
- **`eliminationTiedRank(bracketRank)`** — Convert sequential rank to elimination tied rank
- **`bracketTier(name)`** — Group sibling brackets by stripping trailing letter suffix
- **`generateDateRange(start, end)`** — Inclusive date array from event start to end

---

## Changes Made Today

---

## 1. Fixed Final Standings Tied Ranks

**Problem:** SLC showed our team ranked 15th, but AES shows tied-for-9th. In single-elimination brackets, teams losing in the same round should be tied. Additionally, sibling brackets (e.g., Silver A + Silver B) at the same tier should have their matching elimination rounds tied together.

**Root cause:** The previous algorithm used sequential bracket ranks as-is (1st, 2nd, 3rd, ..., 16th) instead of converting to elimination-style tied ranks (1st, 2nd, T-3rd, T-5th, T-9th).

**Fix in `route.ts` (lines ~636-755):**

### a) `eliminationTiedRank(bracketRank)` helper
Converts sequential bracket rank to elimination tied rank:
- Ranks 1,2 stay as-is
- Ranks 3-4 → 3 (lost in finals/3rd-place match round)
- Ranks 5-8 → 5 (lost in quarterfinals)
- Ranks 9-16 → 9 (lost in round of 16)
- Formula: `Math.pow(2, Math.floor(Math.log2(bracketRank - 1))) + 1`

### b) `bracketTier(name)` helper
Groups sibling brackets by stripping trailing letter suffixes:
- `"Silver A Bracket"` → `"Silver"` (regex: `/\s+[A-Z]$/i`)
- `"Flight 1A Bracket"` → `"Flight 1"` (regex: `/([0-9])[A-Z]$/i` → `$1`)
- `"Gold Bracket"` → `"Gold"` (no suffix to strip)
- `"Flight 4 Bracket"` → `"Flight 4"` (no suffix to strip)

**Critical:** The second regex handles the case where the letter follows a digit without a space (e.g., "Flight 1A"). Without it, Flight 1A and Flight 1B are treated as separate tiers.

### c) Two-pronged final standings logic
- **If any entry has explicit overall ranks** (like LSR's `(27)` suffix in RankText): use those directly, no tied-rank calculation needed.
- **Otherwise** (like SLC): group brackets by tier → within each tier, compute elimination tied ranks across all sibling brackets → assign overall ranks with proper offsets between tiers.

### d) Tier-based overall rank calculation
- Process tiers in order (Gold first, then Silver, then Bronze, then Flights)
- Within each tier, collect all teams from sibling brackets, group by their elimination tied rank
- Teams at the same elimination rank across siblings are all tied
- `baseOffset` accumulates total teams from prior tiers

---

## 2. Fixed Bracket Path Placement Predictions

**Problem:** The "Bracket Paths" section showed where each pool finish rank goes (e.g., "Cross Bracket #1") but did NOT show Win/Lose destination predictions (e.g., "Win → Gold Bracket (1-16) / Lose → Silver A (17-20)").

**Root cause:** The old code used a Tag-based approach (`"Winner of XBrkt#1M1"`) to find where bracket winners/losers go. This only works for unplayed tournaments where final brackets still have unresolved tags. For played tournaments, the tags are replaced with actual team names.

**Fix in `route.ts` (lines ~409-500):**

### a) Team-tracing approach (primary)
1. Find the intermediate bracket's `FutureRoundMatches` to get ranked teams (1st = winner, 2nd = loser)
2. Extract team names from RankText entries
3. Search final day brackets for each team using `extractAllSources` and `FutureRoundMatches`
4. Report which final bracket they ended up in, with the bracket's finish range

### b) Tag-based approach (fallback for unplayed tournaments)
Kept the existing tag-based lookup as a fallback when team-tracing finds nothing.

### c) Same-bracket detection
If winner and loser both end up in the SAME final bracket (meaning the intermediate bracket IS the final bracket, like in ALSC2), don't show "Win/Lose" — just show the bracket's finish range.

---

## 3. Fixed 3rd/4th Place Bracket Path TBD

**Problem:** In LSR, 3rd and 4th place from each pool showed "TBD" instead of their actual bracket destination (Bronze B, Flight 1C, etc.).

**Root cause:** Team texts include explicit rank suffixes that differ between pool data and bracket data. Pool has `"Roots 14-2 Blue (LS) (60)"` but the final bracket has `"Roots 14-2 Blue (LS) (37)"`. The `(60)` vs `(37)` mismatch caused `includes()` and `stripLocationCode()` comparisons to fail.

**Fix:**

### a) `stripAllSuffixes(name)` helper (line ~65)
Strips ALL trailing parenthetical groups: `"Roots 14-2 Blue (LS) (60)"` → `"Roots 14-2 Blue"`
- Regex: `/(\s*\([^)]+\))+\s*$/`

### b) Updated `findBracketForTeamOrTag` comparison (line ~300)
Added `stripAllSuffixes(source) === stripAllSuffixes(searchText)` as a 4th comparison method alongside exact match, includes, and stripLocationCode.

---

## 4. Moved Bracket Paths Section in Frontend

**Problem:** Bracket Paths section was positioned after Work Assignments, far from Pool Standings. The section also showed a misleading "Upcoming" badge.

**Fix in `page.tsx`:**
- **Moved** Bracket Paths to immediately after Pool Standings (before Matches). Flow is now: Pool Standings → Bracket Paths → Matches → Work Assignments → Active Bracket → Final Standings.
- **Removed** the WIN/LOSS/Upcoming badge and score display from Bracket Paths cards (this section is informational/predictive, not a match result tracker).
- **Added** `bracketDate` display on each path card.
- **Removed** unused `hasScores`, `weWon`, `sets` fields from the `FuturePath` interface.
- **Renamed** section header from "Bracket Play" to "Bracket Paths".

---

## Files Changed

### `app/api/tournament/route.ts`
- Added `stripAllSuffixes()` function (~line 63-67)
- Added `eliminationTiedRank()` function (~line 637-640)
- Added `bracketTier()` function with TWO regexes (~line 645-651)
- Added `stripAllSuffixes` comparison in `findBracketForTeamOrTag` (~line 300)
- Rewrote bracket path Win/Lose tracing (~lines 409-500): team-tracing primary, tag-based fallback
- Rewrote final standings calculation (~lines 652-755): tier-based elimination tied ranking
- Fixed ordinal formatting in finish range display

### `app/page.tsx`
- Removed `hasScores`, `weWon`, `sets` from `FuturePath` interface
- Moved Bracket Paths JSX block from after Work Assignments to after Pool Standings
- Simplified Bracket Paths cards: removed badge, removed scores, added bracketDate

---

## Verification Commands

```bash
# SLC - verify our team is T-9th (not 15th)
curl -s "http://localhost:3000/api/tournament?team=g14askyl2ls&event=PTAwMDAwNDIwNDA90&division=207190" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'T-{s[\"overallRank\"]}' if s['tied'] else s['overallRank'], s['teamName']) for s in d['finalStandings'] if s['isUs']]"

# LSR - verify all 4 pool positions have bracket paths (not TBD)
curl -s "http://localhost:3000/api/tournament?team=g14askyl2ls&event=PTAwMDAwNDEyNDA90&division=195174" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f['finishText'], f['nextPlayShort'], f['finishRange'][:60]) for f in d['futurePaths']]"

# ALSC2 - verify bracket paths don't show redundant Win/Lose for same bracket
curl -s "http://localhost:3000/api/tournament?team=g14askyl2ls&event=PTAwMDAwMzY5Njk90&division=171484" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f['finishText'], f['finishRange'][:60]) for f in d['futurePaths']]"
```

## TypeScript Verification
```bash
cd /Users/phoenix06sa/Projects/lone-star-tracker && npx tsc --noEmit
# Should exit 0 with no output
```
