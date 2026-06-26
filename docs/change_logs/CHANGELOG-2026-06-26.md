# Changelog — June 26, 2026

## Branch: `main` (live during USAV JNCs)

**Context:** Live tournament day at the **2026 USAV Girls Junior National
Championship 14-17** (event `PTAwMDAwNDIwNjI90`). Tracking **Austin Skyline 14
Royal** (division `200800`) and friends including **Roots 14-1 Green**
(`g14roots1ls`, division `200821`). Fixes and polish driven by what showed up
wrong on the floor in real time.

> A phone session earlier in the day (Claude Sonnet 4.6) added team name + W-L
> record to each Projected Path rank row (`7311c32`) and wrote up a deferred
> tiebreaker-display plan in `docs/NOTES.md` (`655e64c`). The work below builds
> on that.

---

## 1. Tiebreaker reasoning, shown live

`buildPoolStandings()` already computes a tiebreaker explanation for tied teams
(e.g. "Tied 1-1 on matches, ranked by set % (60.0%)"), but the UI only showed it
*after* a pool finalized — useless mid-tournament.

- Pool standings (tracker): show the tiebreaker once any match is played, not
  just when `FinishRank` posts.
- Projected Path rows: added a tiebreaker line under each rank's team + W-L, via
  a new `teamAtRankTiebreaker` field on `FuturePath` (looked up from
  `buildPoolStandings` by team code).

Files: `lib/tournament/bracket-paths.ts`, `app/page.tsx`.

## 2. Fix pool-play match ordering across days

A pool round that spans days (Thursday's pool continuing on Friday) only matched
matches whose date *equaled* the pool's date; other days fell into an
after-everything safety net — so Friday's matches sorted **after** Saturday's
pool.

- Assign each match day to the latest pool round on/before it (by a chronological
  date key parsed from "Thu, Jun 25"), and render days in order under that pool.
- Result: Thu pool → Thu + Fri matches → Sat pool → Sat matches.

Files: `app/page.tsx`.

## 3. Rank pool teams by live performance before FinishRank posts

A 3-0 team (Roots 14-1 Green) showed at **3rd** in its pool, behind 1-2 and 2-1
teams. During pool play `FinishRank` is null, so ranking by `FinishRank ?? 99`
collapsed to the raw AES slot order.

- New shared `comparePoolTeams()`: use `FinishRank` when posted, else AES
  tiebreaker order — **match win % → set % → point ratio**.
- `buildPoolStandings()` now returns teams in this order; the projection's
  `sortedStandings` / `currentProjectedRank` use it too. Removed the division
  endpoint's weaker secondary sort.
- Fixes the standings table, Division Pool Play, and the projected rank together.
  Completed events (FinishRank authoritative) unchanged; regression smoke
  unchanged.

Files: `lib/tournament/standings.ts`, `lib/tournament/bracket-paths.ts`,
`app/api/division/route.ts`.

## 4. Fold "Predicted Next Round" into "Projected Path"

The two sections overlapped on their first line (both showed the next pool
round). Predicted Next Round's unique value was the **next-round opponents**.

- Removed the separate Predicted Next Round section.
- Each Projected Path top-level row now shows the next round's opponents
  (`vs 2nd Pool 3 · 3rd Pool 8`) alongside team + record + tiebreaker, and still
  expands to the full bracket → win/lose → division chain.
- The opponents line only appears when the next step is another pool round, same
  as before; it drops off once a team reaches the bracket stage.

Files: `app/page.tsx`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- Roots 14-1 Green (`200821`): 3-0 → **rank 1**, `currentProjectedRank=1`;
  standings ordered 3-0, 3-0, 2-1, 1-2, 0-3, 0-3.
- USAV 14s pool-day ordering: Thu pool → Thu/Fri matches → Sat pool → Sat matches.
- Projected Path shows next pool + opponents per finish, expandable to divisions;
  Predicted Next Round no longer renders.
- Regression smoke unchanged across all 8 events.
