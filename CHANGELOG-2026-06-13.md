# Changelog — June 13, 2026

## Branch: `site-updates-2026-06-13` (merged to `main`, commit `91d4388`)

**Context:** First *live, in-tournament* session — 2026 FAST Pre Nationals
(14 & Under, division 203128) is running this weekend (June 13–14), tracking
**Austin Skyline 14 Royal (`g14askyl1ls`)**. Four targeted changes driven by
watching the real Sunday-bracket data render. Verified against the live event.

---

## 1. Every bracket now renders like Gold (not just ours)

Previously only the team's own bracket got the full scored view (rounds, match
cards, scores, WIN badges, resolved winners); all other brackets — Silver,
Bronze, flights — were stuck with the static who-plays-who tree even after
their teams were known and matches scored.

Now **any bracket switches to the scored view once it's populated**, and keeps
the simple tree until then ("the simple look was good when you don't know who's
in it").

- **`lib/tournament/active-bracket.ts`** — extracted the per-bracket builder
  into `buildBracketViewFromPlay(play, teamCode, finishRanges)` and added
  `buildAllBracketViews({ brackets, teamCode, bracketFinishRanges })` returning
  a `Record<bracketName, view>` (last day wins for a given name). `buildActiveBracket`
  now delegates to the shared builder.
- Each view carries two new fields:
  - **`populated`** — `true` when any match has scores **or** both teams are
    real (a slotted team object, not a `"1st-P2"` / `"Winner of…"` placeholder).
    This is the UI's cue to switch from tree → scored view.
  - **`startTime`** — see §2.
- **`app/api/tournament/route.ts`** — returns a new `activeBrackets` map
  alongside the existing single `activeBracket`.
- **`app/page.tsx`** — for each Bracket Play card: our bracket always uses the
  scored view; other brackets use it when `activeBrackets[name].populated`,
  else fall back to the static tree.

## 2. Fixed bracket "starts" time (showed 11:00 AM, should be 8:00 AM)

The bracket header computed its start time from the **root** match of the tree
— but the root is the **final** (the *last* match played), so the header showed
the championship time (11 AM) instead of the bracket's first match (the 8 AM
quarterfinal). Now uses the **earliest scheduled match** in the bracket.

- Fixed in two places: `active-bracket.ts` (`startTime` = earliest scheduled
  match) and `bracket-paths.ts` (track earliest match while walking the tree;
  store on `bracketTrees[name].startTime`; use it for `FuturePath.time`,
  falling back to the old root time only if nothing is scheduled).
- Frontend header prefers the scored view's `startTime`, else `firstPath.time`.
- Verified live: Gold now reads **starts 8:00 AM** (its QF). Silver legitimately
  reads 11:00 AM — that's its real first-match time, not the bug.

## 3. Matches list shows pool play only

The chronological **Matches** list included bracket matches too, which
duplicated the Bracket Play section (the disconnected "next match" card the user
flagged). Filtered the list to `isPoolPlay`; bracket matches live solely in
Bracket Play now. Verified live: 3 pool matches kept, 1 stray bracket match
removed.

## 4. Renamed section: "Work / Ref Assignments" → "Upcoming Work Assignments"

Label-only change in `app/page.tsx`.

---

## Verification

Against live FAST Pre Nationals data (`g14askyl1ls`, division 203128):

| Check | Result |
|---|---|
| `activeBrackets` populated for non-our brackets | Gold **and** Silver, both `populated: true`, 3 rounds / 9 matches each |
| Gold `startTime` | `8:00 AM` (was 11:00 AM) ✅ |
| Silver `startTime` | `11:00 AM` (correct — its real start) |
| `futurePaths` "starts" | rank 1 → Gold `8:00 AM`, rank 4 → Silver `11:00 AM` |
| Matches `isPoolPlay` split | 3 pool / 1 bracket → list now shows the 3 |

`tsc --noEmit` clean; the changed lib files lint clean.

## Known gaps / notes

- **`populated` depends on real team objects** (`FirstTeam.Name`). Before the
  pool play that *feeds* a bracket completes, that bracket stays the simple tree
  — intended behavior.
- The pre-existing `react-hooks/set-state-in-effect` ESLint errors in
  `page.tsx` (localStorage init) are untouched — still cosmetic.
- The `[[deferred-pool-highlight-review]]` item (`isOurTeamRef` over-broad
  highlighting in bracket trees) is still open; not addressed this session.

## Files changed

```
app/api/tournament/route.ts        # expose activeBrackets map
app/page.tsx                       # all-brackets scored view, start time, pool-only matches, rename
lib/tournament/active-bracket.ts   # shared builder + buildAllBracketViews, populated, startTime
lib/tournament/bracket-paths.ts    # earliest-match start time
```
