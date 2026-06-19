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
| 8 | 2026 USAV Girls Junior Nat'l Championship 14-17 | `PTAwMDAwNDIwNjI90` | 42062 | `200800` 14 USA | `g14askyl1ls` | Austin Skyline 14 Royal | Re-pool round listed across 2 days (dup-pool dedup); 48 teams; pre-tournament state |

Notes:
- Event #7 was logged as event `42505` in the June 17 changelog; the actual URL
  token decodes to `45026`. Same division (`213733`), same tournament.
- "Our friends on CTX 12 Mizuno" (event #7) and Austin Skyline 14 Royal at
  USAV Nationals (event #8) are the current live/upcoming events.

## Smoke test

With the dev server running (`npm run dev`), this hits each event's
`/api/tournament` and prints a one-line summary. Re-pool events should show
multiple distinct pool names; none should show a duplicated pool.

```bash
bash docs/regression-smoke.sh
```
