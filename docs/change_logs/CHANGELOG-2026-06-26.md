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

## 5. Division Pool Play: stack pool name and courts

In a pool card header the round name and the court list shared one line, so a
long court list (many courts) squeezed/overlapped the name. Put the name on its
own line with the courts wrapping below it.

Files: `app/page.tsx`.

## 6. Projected Path: don't favor a finish before the pool starts

When the current pool hasn't played yet, every team is 0-0 and the projected
"rank" is just seed/slot order — so flagging a line "On track now" implied a
prediction that hadn't begun.

- Until any match in the pool is played: highlight nothing, leave rows collapsed,
  and show a note ("Prediction hasn't started — your pool is still 0-0…").
- Once play starts, the current line highlights/expands as before. Detected from
  whether any team in the pool has a non-zero record.

Files: `app/page.tsx`.

## 7. Pool ranking scenarios ("what it takes to place")

A popup on each Pool Standings card summarizing what record yields each finish —
the kind of thing a parent group chat asks the night before.

- New **📊 "What it takes to place"** button on the focus team's pool card opens a
  modal with 1st/2nd/3rd… scenarios, the AES tiebreaker order, and a bottom line.
- **Deterministic** (no API/key/cost): round-robin assumption (N teams → N-1
  matches each), placement ≈ N − wins, with set W-L / point differential called
  out as the real tiebreakers. Shows only still-reachable records, so it narrows
  as the pool plays out; shows the final result once a pool completes.
- Adapts to pool size: a 3-team pool → 2-0 / 1-1 / 0-2; a 6-team pool → the full
  5-0 … 0-5 ladder.

Files: `app/page.tsx`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- Pool scenarios for Austin Skyline's 3-team Round 2 pool render 1st=2-0,
  2nd=1-1, 3rd=0-2, matching a hand-written example.
- Roots 14-1 Green (`200821`): 3-0 → **rank 1**, `currentProjectedRank=1`;
  standings ordered 3-0, 3-0, 2-1, 1-2, 0-3, 0-3.
- USAV 14s pool-day ordering: Thu pool → Thu/Fri matches → Sat pool → Sat matches.
- Projected Path shows next pool + opponents per finish, expandable to divisions;
  Predicted Next Round no longer renders.
- Regression smoke unchanged across all 8 events.
