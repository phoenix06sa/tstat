# Changelog — June 17, 2026

## Branch: `friend-tournament-2026-06-17` (merged to `main`, commit `0262c14`)

**Context:** Stress-tested against a large, multi-stage event — **AAU Girls
National Championships – Wave 1, 12 Classic** (event `42505` / division
`213733`, 131 teams). Format: 3 re-pooled pool rounds (Tue–Thu) → Thursday
Crossover/Challenge brackets → Friday "Division" brackets (Championship,
Consolation A/B, and gemstone tiers Ruby…Zircon, most split A/B). This exposed
several assumptions baked in from the smaller one-hop tournaments.

---

## 1. Layout: pool standings and matches interleaved per round

The Matches list was lumped after all pool-standings tables. Now each **round**
shows its pool standings followed by that round's matches, repeated per day.
Matches are tied to rounds by date (verified they line up 1:1).

## 2. Prominent weekday headers

Each round/section now leads with the weekday — **"Tuesday: Pool Standings"**,
**"Tuesday: Matches"** — with the full date ("June 16, 2026") tucked to the
right, smaller. Weekday/month come from a lookup; the year is pulled from the
event's date range (the per-day strings don't carry it).

## 3. "Opponent TBD" for unassigned matches

An upcoming match whose opponent AES hasn't seeded yet (common between rounds in
re-pooling events) rendered as a bare "vs" with no name. Now shows a muted
**"Opponent TBD"** until the opponent is assigned.

## 4. Bracket-path pool matching is round/group-aware (collision fix)

**Bug:** the team's Friday bracket showed the *wrong* divisions. Bracket-path
matching compared only the bare pool **number** and used the team's **first**
pool. The team was in Round 1 "Pool 30"; the divisions seeded `R3G4P30`
(Round 3, **Group 4**, Pool 30) — a different pool sharing the number 30 — and
matched falsely.

**Fix (`lib/tournament/bracket-paths.ts`, `app/api/tournament/route.ts`):**
- `normalizePoolKey()` builds a key keeping round/group/division context.
  Works on a pool's **`CompleteFullName`** ("Round 3 Group 1 Pool 6") and on a
  seed token ("R3G1P6") — both normalize to `R3G1P6`. Note `FullName` is just
  "Pool 6"; the qualified identity is in `CompleteFullName`.
- `parsePoolRef()` now returns `poolKey`; all matching (pool→bracket map,
  is-this-us highlighting, seed/opponent resolution) compares full keys.
- Predictions seed from the team's **latest** pool (the one feeding the final
  brackets), not the first — fixing the long-standing re-pooling gap.

## 5. Multi-stage path prediction (follow Winner/Loser feeds)

In one-hop events a pool finish goes straight to a final bracket (Gold/Silver).
Here, top finishes route **pool → Challenge → Division**, so the immediate
bracket was a Thursday Challenge and the Friday division wasn't shown.

Now the predictor **follows the chain**: it reads AES's text feed references
("Winner of R4Challenge4M1" / "Loser of …"), matches them to a source bracket by
`ShortName`, builds a winner→/loser→ next-bracket map, and walks it from each
immediate bracket to the terminal divisions. E.g. *1st in pool → Challenge 4 →
win: Championship · lose: Consolation A*.

Terminal brackets (Gold/Silver in one-hop events) have no feeds, so this is
empty there and those events are unchanged.

## 6. Bracket Play shows the full division ladder, sorted by finish

Previously only the few brackets on the team's path appeared, so other ranks
looked "missing" (e.g. 27th–33rd). Now Bracket Play lists **every ranked
division in the event, sorted by finish rank**, with the team's path
highlighted (yellow) and off-path divisions muted. Each bracket shows its
predicted who-plays-who tree now and the live scored view once teams are
slotted. Pool standings/matches remain team-only. New `bracketCards` output
(`lib/tournament/bracket-paths.ts`) drives this.

## 7. `ordinal()` fix

`ordinal()` only special-cased 1/2/3, rendering "21th", "33th", "121th".
Harmless when ranks were ≤16, but this 131-team event exposed it. Now correct
for all ranks (21st, 22nd, 23rd, 121st, …) everywhere it's used.

---

## New AES API knowledge

1. **Pool identity is `R{round}G{group}P{pool}`** in bracket seed tokens
   (e.g. `2nd-R3G1P6`). Match on the **full** key — the bare number collides
   across rounds/groups. The qualified name is the pool's `CompleteFullName`,
   **not** `FullName` (which is just "Pool 6").
2. **Cross-bracket links are text-only.** A downstream bracket's leaf carries
   `FirstTeamText: "Winner of R4Challenge4M1"` (no structured source pointer).
   The token is `R{round}{bracketShortName}M{matchNum}`; match the bracket by
   its `ShortName` ("Challenge4"). Brackets also expose `ShortName`.
3. **Multi-stage formats exist:** pool → Crossover/Challenge → Division, across
   days. Final divisions are seeded off the **last** pool round.
4. **Big events pre-publish empty bracket shells** days ahead (real teams = 0,
   scored = 0) — render them as predictions, not results.

## Verification

Live AAU 12 Classic (correct path: 1st→Challenge 4, 2nd→Challenge 6,
3rd→Ruby B, 4th→Diamond A; chains to Championship/Consolation; full 1–131
ladder) plus regression across FAST, Lone Star Regionals, both SLC and both
ALSC2 divisions (one-hop events unchanged: empty chains, same paths, intact
final standings). Production build passes.

## Files changed

```
app/page.tsx                       # interleave layout, weekday headers, TBD opponent, full sorted ladder
app/api/tournament/route.ts        # pool key + latest-pool seeding, expose chainedPaths/bracketCards
lib/tournament/bracket-paths.ts    # normalizePoolKey, feed-following, bracketCards
lib/aes.ts                         # ordinal() fix
```
