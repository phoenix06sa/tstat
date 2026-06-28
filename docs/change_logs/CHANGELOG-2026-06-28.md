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

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds.
- Machine date Sun Jun 28, `eventComplete=false`: pins 🟢 Today + Bracket Play on
  top, Round 2/Round 1 pools under "Earlier days"; reverts to chronological once
  the event completes.
