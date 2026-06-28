# Changelog — June 28, 2026

## Branch: `main` (final day, USAV JNCs)

Two fixes spotted on the last day of the tournament.

---

## 1. "Today on top" broke on the final (bracket-only) day

On the last day every match is bracket play — there's no new pool — so the
"today" pin was reverting to chronological and pushing Thursday back to the top.

- Root cause: the live check required `today ≤ the last *pool* day`. On Sunday
  (past Saturday's pool) that failed, so it fell back to chronological.
- Fix: pin "today" whenever the tournament has **started and isn't complete**
  (`!eventComplete`), not tied to the last pool day. Pools dated today-or-later
  stay up top; past pools drop below. On a bracket-only day every pool is
  "earlier", so the top is just the **🟢 Today** banner above Bracket Play, with
  the pools under "Earlier days" below it.
- Reverts to first→last chronological only once the event is actually complete.

Files: `app/page.tsx`.

## 2. "Home" button: visible and reliable

- It was a faint text link; made it a clear bordered button (`← Home`).
- It used `history.back()`, which could no-op if browser history got out of sync
  (e.g. after an auto-reload). Now it sets the view to the hub directly (always
  works) and unwinds the pushed history entry so device back/forward stays
  consistent.

Files: `app/page.tsx`.

## 3. Court Play: all divisions (bracket play)

Court Play was scoped to our division, which wasn't that useful — a floor hosts
many divisions through the day. Now `/api/court-schedule` aggregates **bracket
matches across every division** (24 here) from each division's plays endpoint,
each row tagged with its division. Our division's **pool** matches still come
from its team schedules (pool match grids aren't reachable for other divisions).

- Verified court 67 ICC on 2026-06-28 reproduces the full AES schedule across
  divisions: 8 AM (14 American) → 9–11 AM (14 USA Silver A) → 12–2 PM (14
  American), with real team names. 946 matches / 100 courts.
- Cost note: ~150 cached requests (other divisions only on bracket days), so the
  first cold load on a big event takes a beat; fine thereafter.

Files: `app/api/court-schedule/route.ts`, `app/page.tsx`.

## 4. Setup: team-name search is the primary path

Adding a team meant picking a division first, with by-name search hidden behind a
button. Flipped it: on the division step, **"Search for your team"** is shown by
default (loads the cross-division team list automatically), with "pick a division
from the list" and the paste-a-URL shortcut as the secondary options.

Files: `app/setup/page.tsx`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- Machine date Sun Jun 28, `eventComplete=false`: pins 🟢 Today + Bracket Play on
  top, Round 2/Round 1 pools under "Earlier days"; reverts to chronological once
  the event completes.
- Court Play all-divisions: 946 matches / 100 courts; our division's 06-25 pool
  matches still present (48).
