# Changelog — June 19, 2026

## Branch: `aau-large-tournament-fixes`

**Context:** Live prep for two events — our friends on **CTX Juniors 12 Mizuno**
(AAU Girls National Championships – Wave 1, 12 Classic, event `PTAwMDAwNDUwMjY90`
/ division `213733`) and our own **Austin Skyline 14 Royal** at the **2026 USAV
Girls Junior National Championship** (event `PTAwMDAwNDIwNjI90` / division
`200800`, "14 USA"). Reviewing the USAV event pre-tournament surfaced a
duplicate-pool bug and a gap in predictions for multi-round-pool formats.

---

## 1. Team highlight: drop the star, add a LOST badge

Our team was marked with a yellow name **and** a leading `★`. The star read like
a trophy — a Thursday challenge-match *loss* looked like a win at a glance.

- Removed the `★` prefix everywhere it appeared (match cards ×2, pool standings,
  final standings). The yellow text, yellow row highlight, and green/red match
  outlines remain as the "follow our team" cues.
- Added a red **LOST** badge next to **our team** on match cards when we lose,
  mirroring the existing green **WIN** badge on the winner. Scoped to our team
  so other teams' losing lines stay clean.

Files: `app/page.tsx`.

## 2. Bug: our pool shown twice (duplicate pool)

At USAV, the Round 1 pool rendered twice. AES lists the same pool on more than
one day's `plays` endpoint when its matches span two days (here Jun 25 **and**
Jun 26), and the day-loop collected it once per day.

- Dedup `ourPools` by pool identity (`CompleteFullName`) while collecting.
  Genuine re-pool rounds keep distinct names, so they're preserved.
- Verified: USAV now shows 1 pool; SLC still shows 2 rounds, AAU still shows 3.

Files: `app/api/tournament/route.ts`.

## 3. Predictions for re-pooling formats (pool → pool)

The path-predictor only mapped **pool → bracket** (parsing bracket leaf-node
seed text). Multi-round-pool events seed the **next pool round** from the current
one, and AES publishes that seeding before play in the next pool's `TeamText`
(`1st-P3`, `2nd-P2`, …). So for an event like USAV pre-bracket, every finish read
"Bracket TBD" even though the data was right there.

- New re-pool map in `buildBracketPaths`: for the team's current pool, find the
  destination pool in the **immediately next round** whose `TeamText` references
  our pool, and read off the pool-mates as predicted opponents.
- Generic: keyed off the team's current pool **round + number** parsed from the
  normalized pool key. Handles both round-qualified refs (`1st-R2G1P3`) and bare
  refs (`1st-P3`) — bare refs are matched to the immediately-preceding round so a
  Round 3 `P3` can't collide with a Round 1 Pool 3.
- Opponents resolve to real team names once their source pools finish (same
  two-tier resolve the bracket predictor already uses); until then they read
  "2nd Pool 2", etc.
- New `nextType` / `nextOpponents` fields on `FuturePath`; new **Predicted Next
  Round** section in the UI, shown only when a re-pool destination exists. Bracket
  events are untouched (predictions still flow to the bracket ladder).

Example (Austin Skyline 14 Royal, USAV Pool 3):

```
1st in Pool → Round 2 Group 1 Pool 3   vs 2nd Pool 2 · 3rd Pool 5
6th in Pool → Round 2 Group 2 Pool 4   vs 4th Pool 5 · 4th Pool 2 · 6th Pool 7
```

Note: this predicts the **immediate** next pool round only (the branching across
multiple future rounds is too wide to be meaningful pre-play); it re-predicts from
the new pool once the team advances. The bracket stage stays TBD until AES seeds
those `Teams` arrays.

Files: `lib/tournament/bracket-paths.ts`, `app/page.tsx`.

## 4. Mobile: stop the page drifting slightly wider than the screen

Reported symptom: on first load of a new tournament the page is *barely* too wide
on a phone. The layout is built correctly (`max-w-2xl mx-auto px-4`, correct
viewport, `truncate` on long names) but had no global horizontal-overflow guard,
so one slightly-too-wide element (a standings table on a narrow phone, the fixed
`w-28` work-assignment date column) could make the whole page scroll sideways.

- **A (safety net):** `overflow-x-hidden` on `<body>`. Placed on the body, not an
  ancestor of the `sticky` header, so sticky positioning is unaffected.
- **B (targeted):** the pool- and final-standings cards now use `overflow-x-auto`
  instead of `overflow-hidden`, so a too-wide table scrolls inside its own card
  and stays readable rather than being clipped.

Files: `app/layout.tsx`, `app/page.tsx`.

## 5. Regression test events

Documented every AES event we've validated against, with team codes and the
format quirk each exercises, plus a runnable smoke script — predictions can't be
replayed on past events, so this is how we keep coverage for new tournaments.

- `docs/REGRESSION-EVENTS.md` — table of 8 events (LSR, SLC ×2, ALSC2 ×2, FAST,
  AAU 12 Classic, USAV) with event tokens, divisions, teams, quirks.
- `docs/regression-smoke.sh` — hits `/api/tournament` for each; reports distinct
  pool names (flags any duplicate), totals, final standings, and re-pool
  prediction count.

(Correction: the June 17 changelog listed the AAU event as `42505`; the URL token
actually decodes to `45026` — same tournament/division.)

---

## Verified

`bash docs/regression-smoke.sh` — no duplicate pools; SLC/ALSC2/AAU re-pool rounds
intact; bracket events still predict brackets; USAV shows `repoolPred=6`. No new
ESLint errors (the 4 remaining are the pre-existing `set-state-in-effect`
localStorage-init warnings).
