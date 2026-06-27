# Changelog — June 27, 2026

## Branch: `main` (live during USAV JNCs)

**Context:** Day 3 at the **2026 USAV Girls Junior National Championship 14-17**
(event `PTAwMDAwNDIwNjI90`). Polishing the Projected Path for the
pool-hasn't-started state and locking down regression coverage / docs before the
events age out.

---

## 1. Projected Path starts "even" until the pool plays

Even with the "prediction hasn't started" note, each finish row still pinned a
specific team to a rank (EXCEL at 1st, You at 2nd, HP Illinois at 3rd) with a
meaningless "ranked by point ratio (N/A)" tiebreaker — because before any match
the rank is just seed/slot order.

- When the pool hasn't started, hide the per-rank team name + W-L and the
  tiebreaker line. The three finish rows then read as equally possible ("1st in
  pool → … / 2nd in pool → … / 3rd in pool → …"), which is the point of the
  feature: who *will* finish where, not who's seeded where.
- Once any match in the pool is played, the team names, records, tiebreakers, and
  the highlighted "On track now" line all come back. The pool standings table is
  untouched (still shows the normal seed-based order).

Files: `app/page.tsx`.

## 2. Docs: format-dependent features — don't "fix" them away on small events

Added a warning section to `docs/NOTES.md` with a table of which features need
which tournament format (Projected Path → multi-stage; Challenge Rounds →
intermediate brackets; Starting Seeds → published seeds; re-pool opponents →
re-pooling; etc.) and the two data-lifecycle gotchas (seeds/feed refs get
overwritten once brackets populate; pools are 0-0 before play). The point: many
of the best features are intentionally empty/hidden on small single-bracket
events — loosening the gates to make them show there breaks them on the big
multi-stage events they were built for.

Files: `docs/NOTES.md`.

## 3. Regression: lock in the multi-stage USAV events + removal warning

- Updated event #8 (USAV `200800`, Austin Skyline 14 Royal) from its old
  "pre-tournament" note to what it now exercises: the multi-stage Projected Path,
  the `resolveFeed` seed-strip fix, pool-day ordering, and the "prediction hasn't
  started" state.
- Added event #9 (USAV `200821`, Roots 14-1 Green) — the division that drove the
  live-performance ranking fix (a 3-0 team shown 3rd before `FinishRank` posts).
- Added a ⚠️ note: AES removes old tournaments on an unknown schedule, so the
  2026 events (especially the big multi-stage #7–#9) may stop returning data well
  before next season (timeline: December 2026). When the smoke test prints
  `ERROR`/"event not found" for those rows, that's the data aging out, not a code
  regression — swap in fresh live multi-stage events before next season.
- `regression-smoke.sh`: added the `200821` row and a `proj=Nbr/Mdiv` indicator
  (top-level branches / distinct division leaves) so the smoke test catches a
  broken Projected Path chain. USAV rows now report `proj=3br/5div`.

Files: `docs/REGRESSION-EVENTS.md`, `docs/regression-smoke.sh`.

## 4. Bug: division brackets vanished once the bracket stage was reached

Once Austin Skyline's pool play finished and brackets were live, the Bracket
Play section lost every division (Gold/Silver/Bronze/Flights) — only the
Challenge brackets remained, and the team's actual bracket (Silver A) showed
empty via the fallback.

- Root cause: `finalDay` was `allDaysPlays[last]` — the last *calendar* day. AES
  now publishes **empty arrays** for later event days (06-29 → 07-03), which got
  included, so `finalDay` pointed at an empty day. `buildFinishRanges([])` →
  `totalTeams: 0` → no division got a finish range → no division card.
- Fix: pick `finalDay` as the last day that actually **has brackets**, not the
  last calendar day. Also fixes a latent bug where final standings would never
  appear once this event completes (its last bracket day ≠ its last calendar day).
- After: `totalTeams: 48`, all divisions back with ranges (Gold 1st–8th, Silver A
  9th–12th, …). Completed events unchanged (their last day already had brackets).

Files: `app/api/tournament/route.ts`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- `bash docs/regression-smoke.sh`: all 9 rows OK, no duplicate pools; both USAV
  divisions now `totalTeams=48` (was 0); completed events unchanged
  (AAU 131/131, LSR 64/64, etc.).
- Projected Path for Austin Skyline's not-yet-started pool shows no team pinned to
  a finish and no "(N/A)" tiebreaker; reverts to full detail once a match is
  played.
