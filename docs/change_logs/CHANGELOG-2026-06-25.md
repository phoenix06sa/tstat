# Changelog — June 25, 2026

## Branch: `changes-2026-06-25` → `main`

**Context:** Reworking the app from a single tracker page into a **hub** that
branches to several feature screens, and adding division-wide views that aren't
tied to one team. Validated against the live **2026 USAV Girls Junior National
Championship 14-17** (event `PTAwMDAwNDIwNjI90` / division `200800`, **Austin
Skyline 14 Royal**), which is mid-pool-play and publishes seeds, and the
completed **AAU 12 Classic** (event `PTAwMDAwNDUwMjY90` / division `213733`),
which is finished and publishes no seeds.

---

## 1. Hub landing screen

The app now opens on a hub of boxes instead of dropping straight into the
tracker. Each box leads to one feature; a **← Home** button (and the device/
browser **back button**) returns to the hub.

- Six boxes: **Live Tracker**, **Division Pool Play**, **Court Play**, **Work
  Schedule**, **Starting Seeds**, **Final Standings**.
- Navigation uses `history.pushState` + a `popstate` handler, so back/back-swipe
  works naturally on the home-screen app (one history entry per feature; the
  hub is the root).
- The header (event, focus team, tournament switcher, share, refresh, settings)
  stays on every screen for context.

Files: `app/page.tsx`.

## 2. Live Tracker trimmed; Work Schedule & Final Standings split out

The primary team view kept growing; its two tail sections are now their own
screens reached from the hub.

- **Live Tracker** = pool standings + matches, Predicted Next Round, Challenge
  Rounds, Bracket Play. Work assignments and final standings were **removed**.
- **Work Schedule** view: the team's work/ref assignments (empty-state message
  when there are none).
- **Final Standings** view: the overall results table, **gated** — until the
  event is complete it shows "Final standings aren't in yet · Coming at the end
  of the tournament" instead of an empty table.

Files: `app/page.tsx`.

## 3. Division Pool Play (everyone's pools)

A team-agnostic view of every pool in the division, not just the focus team's.

- Pools grouped by round (e.g. "Round 1", "Round 2 Group 1"), each with a compact
  standings table (rank, team, match record) and its court(s).
- When pool play is complete, a notice up top: "Pool play is complete → head to
  Live Tracker and pick a team to follow bracket play."
- The **focus team is highlighted** (yellow row) wherever it appears.

Files: `app/page.tsx`, `app/api/division/route.ts` (new).

## 4. Court Play (find teams by floor)

- A grid of every court/floor used in the division; tap one to see the pool(s)
  scheduled there and their teams.
- Floors where the **focus team** is scheduled are tinted and labeled "Your team
  plays here," so you can spot your court without drilling in.
- Note: AES exposes court at the pool level (a pool can span several courts), not
  per match, so a floor lists the full team list of any pool assigned to it. Good
  for "who's on this floor" during pool play; live per-match court tracking during
  brackets would be a later addition.

Files: `app/page.tsx`, `app/api/division/route.ts`.

## 5. Starting Seeds (pre-tournament overall ranking)

- The division's starting seed list (1, 2, 3, …), read from the AES pool team
  text `Name (LOC) (N)` — the trailing `(N)` is the seed. The earlier
  location-code group disambiguates it from re-pool slot refs like `1st-P1 (1)`.
- Focus team highlighted; top-3 seeds accented.
- Events that don't publish seeds (AAU) show a clean "No starting seeds
  published" empty state. Note: seeds live in the data at the **start** of an
  event and are overwritten as brackets populate, so this is most reliable
  early/in-progress.

Files: `app/page.tsx`, `app/api/division/route.ts`.

## 6. New `/api/division` endpoint

One team-agnostic endpoint backs all three new views: all pools (deduped,
round-sorted, with standings + courts + a complete flag), the seed list, the
court→pools→teams map, and a `poolPlayComplete` flag (true once any bracket is
scored or every pool is final). Fetched lazily the first time a division view
opens, then refreshed on a 90s tick while one is showing; cleared when the
tournament is switched.

Files: `app/api/division/route.ts`.

---

## 7. Projected Path — full win/loss tree to a division

The predictor stopped one hop out (pool finish → next pool round). The Live
Tracker now projects the **whole** path: every finish → its bracket → win/lose
→ the division you'd land in — the AES "suppose a win or loss" view, assembled
automatically and chained through every stage.

- `buildBracketPaths` now returns a recursive `projection` tree (pool finishes
  branch by rank; brackets branch Win/Lose; divisions are leaves) plus
  `currentProjectedRank`. It reuses the maps the cards already build —
  `poolRankToBracket` (finish → bracket) and `advances` (bracket feed graph) —
  generalized with a pool→next-pool map so it can walk multiple re-pool rounds.
- UI: a collapsible **Projected Path** section in the tracker. The team's current
  line is expanded by default and badged "On track now"; Win branches are green,
  Lose red. Shown only while an event is in progress.
- **Bug fixed:** `resolveFeed` didn't strip the trailing seed in feed refs like
  `Loser of cxG1C1M1 (16)`, so the bracket feed graph came back empty for these
  events. That's the same gap that left `chainedPaths` empty earlier (parked from
  the June 23 session) — fixing it powers both the projection and the
  chained-bracket cards.

Note: division **finish ranges** (e.g. "Gold · 1st–8th") fill in once the bracket
stage seeds; they're blank very early (`totalTeams: 0`). Like seeds, the feed refs
are overwritten with real team names once brackets populate, so the projection is
a live/upcoming-event feature.

Example (Austin Skyline 14 Royal, currently 2nd in Round 1 Pool 3):

```
2nd in pool → Round 2 Group 1 Pool 2
  1st → Challenge 2   Win → Gold     Lose → Silver B
  2nd → Challenge 1   Win → Gold     Lose → Silver A
  3rd → Challenge A   Win → Bronze   Lose → Flight 1
```

Files: `lib/tournament/bracket-paths.ts`, `app/api/tournament/route.ts`,
`app/page.tsx`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds; `/api/division` registered.
- Projected Path resolves the full tree on USAV 14s (matches a manual trace);
  regression smoke unchanged across all 8 events; the projection is hidden on
  completed events (AAU) as intended.
- USAV 14s `200800` (live): 22 pools, **48 seeds** (seed 1 = Vaqueras 14F
  Gilbert, **Austin Skyline 14 Royal = 16**, matches AES), 33 courts;
  `poolPlayComplete=false`; focus-team highlight shows across pools/seeds/courts.
- AAU `213733` (complete): 99 pools, **0 seeds** (none published → empty state),
  43 courts; `poolPlayComplete=true` → Division Pool Play shows the "go to Live
  Tracker" notice.
- No new ESLint errors (the remaining `set-state-in-effect` warnings are
  pre-existing).
