# Changelog — June 30, 2026

## Branch: `main`

## Fix: "Today" pin didn't revert after the tournament ended

Opening last weekend's (now-finished) tournament still showed the **🟢 Today**
banner and kept today pinned, instead of reverting to first→last chronological.

- Root cause: the pin was gated on `!eventComplete`, but AES leaves
  `eventComplete` **false even days after the event** (final standings were in,
  yet the flag stayed false). So the pin never released.
- Fix: pin "today" only while the device date falls **within the event's actual
  day window** — and include **bracket days** (`bracketCards[].bracketDate`) so
  the window's end is the last day of play (the final bracket day), not the last
  pool day. Once today is past the last day, it reverts to chronological with no
  banner. No longer depends on `eventComplete`.
- Verified (window Jun 25–28): Sun Jun 28 still pins; Mon 29 / Tue 30 revert to
  chronological.

Files: `app/page.tsx`.
