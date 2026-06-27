# Regression Test Events

Every AES tournament we've validated the tracker against, with the team we
follow and the format quirk it exercises. Use these to smoke-test changes
before merging — each one previously caught or drove a fix.

The event token is the value in the AES URL (`/event/<token>/...`). Its numeric
id is shown for reference (`base64("=" + id.padStart(10,'0') + "=") + "0"`).

| # | Tournament | Event token | (num) | Division | Team code | Team | Quirk exercised |
|---|---|---|---|---|---|---|---|
| 1 | 2026 Lone Star Regionals | `PTAwMDAwNDEyNDA90` | 41240 | `195174` 14 Bid | `g14askyl2ls` | Austin Skyline 14 Black | Baseline: explicit overall ranks, challenge brackets, one-hop |
| 2 | 2026 SLC Showdown | `PTAwMDAwNDIwNDA90` | 42040 | `207190` 14L | `g14askyl2ls` | Austin Skyline 14 Black | Re-pooling (2 rounds), tied ranks (T-9), both pools shown |
| 3 | 2026 SLC Showdown | `PTAwMDAwNDIwNDA90` | 42040 | `207193` 14 Open | `g14askyl1ls` | Austin Skyline 14 Royal | 2-team Gold, standalone 5th-place bracket, rank gaps |
| 4 | adidas Lone Star Classic 2 | `PTAwMDAwMzY5Njk90` | 36969 | `171484` | `g14askyl2ls` | Austin Skyline 14 Black | Direct-to-bracket (no intermediate step), 123 teams |
| 5 | adidas Lone Star Classic 2 | `PTAwMDAwMzY5Njk90` | 36969 | `171486` 14s | `g14askyl1ls` | Austin Skyline 14 Royal | Refinement 5th-place bracket, unplayed 3rd-place match, unscheduled final |
| 6 | 2026 FAST Pre Nationals | `PTAwMDAwNDI0NjU90` | 42465 | `203128` 14&U | `g14askyl1ls` | Austin Skyline 14 Royal | Live Sunday-bracket rendering, 16 teams |
| 7 | AAU Girls Nat'l Champs – Wave 1, 12 Classic | `PTAwMDAwNDUwMjY90` | 45026 | `213733` 12 Classic | `g12ctxjr1ls` | CTX Juniors 12 Mizuno | 131 teams; 3 re-pool rounds → Crossover/Challenge → gemstone Divisions (multi-stage) |
| 8 | 2026 USAV Girls Junior Nat'l Championship 14-17 | `PTAwMDAwNDIwNjI90` | 42062 | `200800` 14 USA | `g14askyl1ls` | Austin Skyline 14 Royal | **Multi-stage**: re-pool (R1→R2) → Challenge brackets → Gold/Silver/Bronze/Flight divisions. Drove the **Projected Path** win/lose tree, the `resolveFeed` seed-strip fix, pool-day ordering (Thu/Fri/Sat), and the live "prediction hasn't started" state |
| 9 | 2026 USAV Girls Junior Nat'l Championship 14-17 | `PTAwMDAwNDIwNjI90` | 42062 | `200821` 14 American | `g14roots1ls` | Roots 14-1 Green | Same event, different division. Drove the **live-performance ranking** fix (a 3-0 team was shown 3rd because `FinishRank` is null mid-pool — now ranked by match% → set% → point ratio) |

Notes:
- Event #7 was logged as event `42505` in the June 17 changelog; the actual URL
  token decodes to `45026`. Same division (`213733`), same tournament.
- "Our friends on CTX 12 Mizuno" (event #7) and Austin Skyline 14 Royal at
  USAV Nationals (events #8/#9) were the live multi-stage events these
  prediction features were built against.

> ## ⚠️ These events may disappear before next season
> AES eventually removes/archives old tournaments, and we don't know the
> retention window. The **2026** events above (especially the big multi-stage
> ones, #7–#9) may stop returning data well before the next season starts
> (timeline: **December 2026**). When that happens the smoke test will print
> `ERROR` / "event not found" for those rows — that's the data going away, not a
> code regression. **Before next season, swap in fresh live multi-stage events**
> and update this table + `regression-smoke.sh`.
>
> Just as important: **most tournaments during the year are small** (single
> bracket, no re-pool, no published seeds). Many of the best features here only
> light up on big multi-stage events — see the format-dependent features table in
> `docs/NOTES.md`. Don't "fix" an empty Projected Path / Challenge Rounds /
> Starting Seeds on a small event by loosening the gates; you'll break them for
> the events they were built for. Validate on a live multi-stage draw.

## Smoke test

With the dev server running (`npm run dev`), this hits each event's
`/api/tournament` and prints a one-line summary. Re-pool events should show
multiple distinct pool names; none should show a duplicated pool.

```bash
bash docs/regression-smoke.sh
```
