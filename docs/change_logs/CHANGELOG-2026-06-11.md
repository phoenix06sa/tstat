# Changelog — June 11, 2026

## Branch: `improvements/review-and-polish` (merged to `main`)

**Context:** First session using Claude Code directly in VS Code (previous sessions used Devin/Hermes Agent). Started as a full code review, became a cleanup + hardening pass validated against five different AES tournament formats.

---

## 1. Architecture Refactor

The 1,000-line `app/api/tournament/route.ts` is now a ~170-line orchestrator. All logic moved verbatim into typed modules:

```
lib/
├── aes.ts                        # Shared AES helpers (fetch, date/time fmt, name stripping, tree walk)
└── tournament/
    ├── types.ts                  # DayPlays, BracketEntry, FinishRange
    ├── standings.ts              # Pool standings + tiebreaker explanations
    ├── matches.ts                # Match list (past+current) + work assignments
    ├── bracket-paths.ts          # parsePoolRef, finish ranges, bracket trees, future paths
    ├── active-bracket.ts         # Scored bracket view with "Winner of..." resolution
    └── final-standings.ts        # RankText parsing, elimination tied ranks, tier grouping
```

**Verification method:** byte-diffed full API JSON output before/after the refactor against all three reference tournaments — identical.

## 2. Removed All Hardcoded Tournament Data

- **Deleted `/previous` page + API route** — hardcoded to SLC Showdown. Past tournaments work through the same `/setup` flow (paste the AES URL).
- **Removed fallback date list** (2026-05-09 … 2026-07-19) and default event/division/team IDs from API routes. Routes return 400 when params are missing.
- **"of 64" and "(3rd–16th)" UI labels** replaced with data-driven `totalTeams` computed from final-bracket team counts.

## 3. Bug Fixes

| Fix | Detail |
|---|---|
| Swallowed errors | `fetchData` threw inside its own try/catch, discarding structured API error messages |
| UTC date off-by-one | Bare `YYYY-MM-DD` parsed as UTC midnight → previous day in US timezones. All date parsing now anchors at local noon |
| Unscheduled matches sorted first | Matches with no `ScheduledStartDateTime` (timestamp 0) appeared at top under "Unknown". Now fall back to their play's day, sort to end of day |
| `0001-01-01` sentinel | AES uses `0001-01-01T00:00:00` for "no scheduled time" (finals that follow semis). Now treated as unscheduled everywhere |
| Tiebreaker wording | Said "advanced by set %" for every tied team including the losers — now "ranked by" |
| Placement bracket double-count | See section 6 |

## 4. UI Restructure

- **"Pool Play" section renamed "Matches"** — it always contained bracket matches too (with Pool/Bracket badges).
- **One standings table per pool** — re-pooling tournaments (SLC, ALSC2) show each day's pool, dated. API returns new `pools[]` array.
- **Merged bracket sections.** "Bracket Play" is the single bracket section: our bracket renders the full scored view (rounds, WIN badges, resolved winners, placement matches) in place of the static who-plays-who tree; other brackets keep static trees. The standalone scored section only renders as a fallback when our bracket isn't among the Bracket Play cards (e.g. SLC where paths point at day-1 cross brackets).
- **Saved tournaments show real names.** `/api/teams` now returns the real event/division names from AES metadata; new lightweight `/api/event-info` endpoint backfills placeholder names on page load without visiting each entry.
- **"No result recorded"** instead of "No scores yet" for unplayed matches once the event is over (new `eventComplete` flag in API response).

## 5. New AES API Knowledge (add to the pile)

1. **`ScheduledStartDateTime: null` or `0001-01-01T00:00:00`** = match has no fixed time. Typical for finals/3rd-place matches that follow the semis. The play's day is the only date you get.
2. **3rd-place matches are often never played.** AES still assigns RankText ranks (3 and 4) to both teams. `HasScores` stays false forever. AES's own UI shows the tie.
3. **Bracket formats vary BY DIVISION within the same event.** SLC Showdown 14L had Gold(8)/Silver/Flights; SLC 14 Open had a 2-team Gold (single final match), a 2-team "5th Place Bracket", and three 6-team Flights.
4. **Two different meanings of "Nth Place Bracket":**
   - *Refinement* (ALSC2 "5th Pl Bracket"): Gold quarterfinal losers replay for exact 5th–8th. Teams already hold ranks in Gold → must be EXCLUDED from standings/team counts or they double-count.
   - *Standalone* (SLC 14 Open "5th Place Bracket"): two teams' only final-day play → must be INCLUDED, anchored at rank N.
   - **Detection must be data-driven:** a bracket is a refinement iff every ranked team in it already appears in an earlier final-day bracket. Name matching alone breaks one case or the other.
5. **Rank gaps are real.** SLC 14 Open ranks 3–4 are decided by day-2 pool results with no day-3 bracket — those teams exist nowhere in final-day bracket data. Standings legitimately skip 3–4.
6. **The AES `/standings` page has no public JSON endpoint** — it returns the SPA HTML. Overall standings must be derived from bracket RankText (as we do).
7. **`/api/event/{id}`** returns `Name`, `StartDate`, `EndDate`, `Divisions[]` (with `DivisionId`/`Name`), `Facility.Name` — cheap cached call for metadata.

## 6. Final Standings Logic (current state)

Processing order for final-day brackets (in play order):
1. Skip brackets where **all ranked teams already seen** in earlier brackets (refinement replays). Fallback when no results yet: skip if name matches "Nth Pl/Place".
2. Otherwise include; if name encodes "Nth Place", **anchor base rank at N** (leaves honest gaps).
3. Explicit overall ranks in RankText (e.g. LSR's `(27)` suffix) are used directly when present.
4. Otherwise: elimination tied ranks within tier (sibling brackets grouped by name minus trailing letter), offsets accumulate.
5. Final dedupe by team name — first (highest) placement wins.

## 7. Repo / Infra

- `tsconfig.tsbuildinfo` and `.claude/settings.local.json` gitignored.
- Stale branches deleted (local + origin): `backup-working-code`, `backup-working-code-v2`, `code-review`, `feature/bracket-paths-ranking`. Only `main` + work branches remain.
- Netlify pipeline confirmed working (deploys on push to `main`).

## 8. Verified Against

| Tournament | Division | Format quirk exercised | Status |
|---|---|---|---|
| 2026 Lone Star Regionals | 14 Bid (195174) | Explicit overall ranks, challenge brackets | ✅ unchanged output |
| 2026 SLC Showdown | 14L (207190) | Re-pooling, tied ranks (T-9) | ✅ + now shows both pools |
| 2026 SLC Showdown | 14 Open (207193) | 2-team Gold, standalone 5th Place bracket, rank gaps | ✅ fixed this session |
| adidas Lone Star Classic 2 | 171484 | Direct-to-bracket | ✅ unchanged output |
| adidas Lone Star Classic 2 | 14s (171486) | Refinement 5th Pl bracket, unplayed 3rd-place match, unscheduled final | ✅ fixed this session |
| 2026 FAST Pre Nationals | 14&U (203128) | Pre-tournament state (this weekend's event) | ✅ placeholders render, awaiting live test |

## 9. Known Gaps / Future Items

- **Bracket-path predictions use the FIRST pool's number** for the `poolNum_rank` mapping. In re-pooling tournaments the final brackets seed from the LAST pool — paths may mismatch mid-tournament in re-pool formats. Standings/matches/brackets are unaffected.
- **Deferred:** `isOurTeamRef` in bracket-paths flags any reference to our pool (any rank) as "us" — pool-mates may get our highlight in bracket trees. User reviewed and wants to revisit with live data.
- **5 pre-existing ESLint errors** (`react-hooks/set-state-in-effect`) in page.tsx/setup — the localStorage-init pattern. Cosmetic; not touched.
- Ranks 3/4 style gaps could be filled by deriving placements from prior-day pool FinishRanks (enhancement).
- Live in-progress Sunday view untested this session — FAST Pre Nationals (June 13–14) is the real test.
