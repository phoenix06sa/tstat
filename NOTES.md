# tstat — Tournament Tracker: Project Notes

**Last updated:** May 9, 2026  
**Author:** Built with Hermes Agent (claude-sonnet-4-6)  
**GitHub:** https://github.com/phoenix06sa/tstat  
**Netlify:** (connect repo to Netlify — see deploy section below)

---

## What This Is

A mobile-friendly Next.js web app that tracks a volleyball team through a tournament weekend in real time. It pulls live data from the AES (Advanced Event Systems) tournament platform and displays:

- Pool standings with tiebreaker explanations
- All pool match results with set scores (WIN/LOSS badges)
- Challenge bracket matchups with confirmed opponents
- Bracket outcome paths — best and worst possible finish for each pool result
- Sunday bracket seeding once it populates Saturday night
- Auto-refreshes every 90 seconds

Built for the 2026 Lone Star Regionals, tracking **Austin Skyline 14 Black (g14askyl2ls)** in the 14 Bid division. Designed to be reused for any team in any AES tournament next season with minimal changes.

---

## ⚠️ Important Caveat — One Tournament Sample

Everything in this document is based on a **single tournament**: the 2026 Lone Star Regionals (12-14s), 14 Bid division, 64 teams. We have no way to know yet how much of this generalizes to other tournaments. Here's our best assessment:

**Almost certainly the same across AES tournaments:**
- The API endpoint patterns (same URL structure, same headers needed)
- The core data fields (`TeamCode`, `TeamId`, `MatchesWon`, `FinishRank`, `HasScores`, `Sets`, etc.)
- The `/schedule/current`, `/schedule/past`, `/schedule/future`, `/schedule/work` endpoints
- The `Roots` tree structure for brackets (with `TopSource`/`BottomSource` nesting)
- The fact that seed text (`1st-P5`) gets replaced with real team names after pool play
- The fact that `/schedule/future` only returns 1st/2nd place paths (not 3rd/4th) during pool play

**Likely to differ between tournaments:**
- The number of teams and pools (this one had 64 teams, 16 pools of 4 — other events may have 32, 48, 128, etc.)
- The bracket tier names (Gold/Silver A-D/Bronze A-D/Flight 1A-D was specific to this 64-team format — a 32-team event will have a completely different structure)
- The finish ranges (1st–16th for Gold, 17th–20th for Silver, etc. all depend on team count and bracket sizes)
- The number of Saturday evening challenge brackets (we had 16 because we had 16 pools — scales with pool count)
- Whether there IS a Saturday evening round at all — some smaller tournaments go straight from pool play to Sunday brackets with no Saturday evening play
- The specific courts, times, and session dates
- Whether 3rd/4th place play Saturday evening or skip to Sunday (this varied even within this event)

**What this means for next season:**
- The API discovery code and endpoint patterns should work as-is on any AES tournament
- The `sundayFinishRanges` map (Gold → 1st–16th, Silver → 17th–20th, etc.) will need to be recalculated based on the new tournament's team count and bracket names — check `/plays/{sunday_date}` to see what brackets exist and how many teams feed into each
- The bracket tier logic may need updating if the tournament uses different naming conventions
- Finding EVENT_ID, DIV_ID, and TEAM_CODE is always manual — we need the URL to start

**The single best thing you can do to restart next season:**
Paste the AES results URL into the chat. Something like:
> "Here is next year's tournament: https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview — our team code is g15askyl1ls"

That's enough to get started. Hermes can pull the API, discover the bracket structure, compare it to these notes, and figure out what needs to change. The core code will likely need only 3-4 constant updates (event ID, div ID, dates) for a similar tournament, or a bit more work if the bracket structure is significantly different.

**Open question for next season:** Could we automate finding the URL? Possibly — AES may have a search endpoint, or the club posts it on their website. A future enhancement would be a small input where you paste the AES URL once and everything auto-discovers. That's the right long-term solution, especially once this gets integrated into the Austin Select Volleyball site.

---

## The AES Platform (Critical Background)

AES (Advanced Event Systems) is the tournament software used by most USAV regional qualifiers and nationals. Results pages are at:

```
https://results.advancedeventsystems.com/event/{EVENT_ID}/divisions/{DIV_ID}/overview
```

The site is a JavaScript SPA. The real data comes from a JSON API, not the HTML. Everything we built reverse-engineers that API.

### How to Find the IDs for a New Tournament

1. Go to the tournament results URL (the club posts it on their website or AES sends it)
2. The URL contains the EVENT_ID: e.g. `PTAwMDAwNDEyNDA90`
3. Click on your division in the UI — the URL changes to include the DIV_ID: e.g. `195174`
4. Open browser DevTools → Network tab → filter by `/api/` — you'll see requests like:
   - `/api/event/{EVENT_ID}/division/{DIV_ID}/plays/2026-05-09`
5. To find your TEAM_ID and TEAM_CODE, look at `/api/event/{EVENT_ID}/division/{DIV_ID}/plays/{date}` — scroll through the pool Teams arrays to find your team. The TeamCode looks like `g14askyl2ls` and the TeamId is a number like `84723`.

**For the 2026 Lone Star Regionals:**
- EVENT_ID: `PTAwMDAwNDEyNDA90`
- DIV_ID: `195174`
- TEAM_ID: `84723`
- TEAM_CODE: `g14askyl2ls`
- TEAM_NAME: Austin Skyline 14 Black

---

## Key API Endpoints (All GET, No Auth Required)

All endpoints are on `https://results.advancedeventsystems.com`. Send these headers to avoid getting blocked:

```
accept: application/json, text/plain, */*
origin: https://results.advancedeventsystems.com
referer: https://results.advancedeventsystems.com/
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...Chrome/124...
```

| Endpoint | What it returns |
|---|---|
| `/api/event/{EVENT}/division/{DIV}/plays/2026-05-09` | All pools + Saturday brackets with full team data, match structure, scores |
| `/api/event/{EVENT}/division/{DIV}/plays/2026-05-10` | All Sunday brackets with seeding tree |
| `/api/event/{EVENT}/division/{DIV}/team/{TEAM_ID}/schedule/current` | Team's current/upcoming match(es) |
| `/api/event/{EVENT}/division/{DIV}/team/{TEAM_ID}/schedule/past` | Team's completed matches with scores |
| `/api/event/{EVENT}/division/{DIV}/team/{TEAM_ID}/schedule/work` | Team's referee/work assignments |
| `/api/event/{EVENT}/division/{DIV}/team/{TEAM_ID}/schedule/future` | Potential next bracket paths (1st/2nd only — see gotcha below) |
| `/api/event/{EVENT}/division/{DIV}/playdays` | List of days with HasPools/HasBrackets flags |

### Critical Gotcha: /schedule/future Changes Over Time

- **Before pool play:** returns 2 paths with PotentialRankText like `1st-P5` and `2nd-P5`, pointing to the Saturday challenge bracket
- **After pool play:** returns 2 paths pointing directly to Sunday brackets (Gold/Silver) — the intermediate challenge bracket step is gone
- **It NEVER returns 3rd or 4th place paths** — those teams skip Saturday evening and go straight to Sunday lower brackets

**Solution we built:** Use the Saturday bracket `Roots[].Match.FirstTeam.Code` / `SecondTeam.Code` fields to find which challenge bracket each pool team lands in (matched by TeamCode), then use Sunday bracket `Roots` tree to find 3rd/4th placement by team name text (`"TeamName (LS)"` format).

### Critical Gotcha: Pool Seed Text Gets Replaced

- **Before pool play ends:** Saturday bracket Roots show `FirstTeamText: "1st-P5"`, `SecondTeamText: "2nd-P6"`
- **After pool play ends:** Those get replaced with actual team names like `"Austin Skyline 14 Black (LS)"`
- Similarly, Sunday bracket sources change from `"3rd-P5"` to actual team name text

**Solution:** After pool play, find which bracket a team is in by matching `FirstTeam.Code` / `SecondTeam.Code` (team codes stay stable). For Sunday brackets, search the full `Roots` tree for the team's text `"TeamName (LS)"`.

---

## Tournament Structure (2026 Lone Star Regionals, 14 Bid Division)

64 teams total, 16 pools of 4 teams each.

**Saturday:**
- Morning: Pool play (3 matches per team, 5-6 hours)
- Evening: 1st and 2nd place from each pool go to Saturday Challenge Brackets (one match each, 16 brackets total)
- 3rd and 4th place from each pool skip Saturday evening — they go straight to Sunday

**Sunday:**
- Gold Bracket: 16 teams (all 16 Saturday challenge bracket winners) → finish 1st–16th
- Silver A/B/C/D: 4 teams each (Saturday challenge bracket losers, split into 4 groups) → finish ~17th–20th
  - Note: Silver A through D are all the SAME tier. The letter is just organizational (different courts/times). Winning Silver D is equal to winning Silver A.
- Bronze A/B/C/D: 4 teams each (3rd place pool finishers) → finish ~33rd–36th
- Flight 1A/B/C/D: 4 teams each (4th place pool finishers) → finish ~49th–52nd

**Bracket seeding pattern for Pool 5 (our pool):**
- Pool 5 1st → Challenge Bracket #5 (vs Pool 6 2nd) → winner to Gold, loser to Silver C
- Pool 5 2nd → Challenge Bracket #6 (vs Pool 6 1st) → winner to Gold, loser to Silver D
- Pool 5 3rd → Bronze B Bracket (Sunday 8:30 AM, GRB Ct 6)
- Pool 5 4th → Flight 1C Bracket (Sunday 9:30 AM, GRB Ct 5)

**For next season:** The bracket numbering pattern will likely be different. Don't hardcode these — the app discovers them dynamically from the Roots tree data.

---

## Tiebreaker Logic

AES uses this order to break ties in pool standings:
1. Match win %
2. Set win %  
3. Point ratio

All three values are available in the API: `MatchPercent`, `SetPercent`, `PointRatio` on each team in the pool play data. The `FinishRank` field is also set once pool play is complete.

**Our implementation:** We group teams by match record, then check if set % differs to determine tiebreaker reason, and display it under each tied team's row in the standings table.

**2026 Pool 5 result:** 3-way tie at 1-2. Austin Skyline 14 Black won 2nd place via set % (42.9%) over Roots (37.5%) and United VBA Purple (28.6%).

---

## Project Structure

```
~/Projects/lone-star-tracker/
├── app/
│   ├── api/
│   │   ├── teams/route.ts        # Returns list of all 64 teams for the dropdown
│   │   └── tournament/route.ts   # Main data API — all match/bracket/path data
│   ├── page.tsx                  # Main UI (client component)
│   ├── layout.tsx
│   └── globals.css
├── netlify.toml                  # Build config for Netlify
├── package.json
├── NOTES.md                      # This file
└── tsconfig.json
```

### app/api/teams/route.ts
Fetches `/plays/2026-05-09`, extracts all teams from all pools, returns them grouped by pool for the dropdown. Called once on page load. Cached 5 minutes.

### app/api/tournament/route.ts
The main workhorse. Accepts `?team={teamCode}` query param (default: `g14askyl2ls`).

Steps it performs:
1. Fetches day1 (Saturday plays) and day2 (Sunday plays) in parallel
2. Finds the team's pool from day1 pool data
3. Fetches team's current/past/work/future schedules in parallel
4. Computes pool standings with tiebreaker explanations
5. Builds match list: combines `past` (completed with scores) + `current` (upcoming/in-progress), deduped by MatchId, tagged `isPoolPlay` vs bracket
6. Finds which challenge brackets each pool rank feeds into — using `FirstTeam.Code`/`SecondTeam.Code` in Saturday bracket Roots (stable after pool play, unlike seed text)
7. Builds all 4 bracket paths with:
   - Real opponent (from bracket match data, not estimates)
   - Scores/result if played
   - Sunday destination for win and loss
   - Best/worst finish range out of 64
8. For 3rd/4th: searches Sunday bracket Roots trees for team's name text `"TeamName (LS)"`
9. Builds Sunday bracket info with team seeding once populated

### app/page.tsx
Client component. Key behaviors:
- Team dropdown groups all 64 teams by pool (Pool 1 → Pool 16)
- Default team: `g14askyl2ls` (Austin Skyline 14 Black)
- Auto-refreshes every 90 seconds via `setInterval`
- Manual refresh button in sticky header
- Shows `timeAgo()` for last refresh time

UI sections (in order):
1. Event info card
2. Pool standings table (with tiebreaker notes under tied teams)
3. Pool matches (with set scores, WIN/LOSS badges)
4. Work/ref assignments
5. **Bracket Play** — 4 cards, one per pool finish position, showing:
   - Who is at that finish position (confirmed after pool play)
   - Which bracket they play in Saturday evening (or Sunday if 3rd/4th)
   - Confirmed opponent
   - Set scores and WIN/LOSS once played
   - Best/worst Sunday finish range out of 64
   - Our card gets yellow border + star marker
6. Sunday brackets — shows all brackets, highlights ours when seeded

---

## Dev Server Notes

This project runs on port 3002 (3000 is Austin Select VB, 3001 is phxSportsCards).

**Important: Turbopack does NOT work on ARM Mac (M1/M2/M3).** Must use webpack flag:
```bash
cd ~/Projects/lone-star-tracker
./node_modules/.bin/next dev --webpack -p 3002
```

The `package.json` dev script already has `--webpack` set. If you see a Turbopack error, this is why.

---

## Netlify Deploy

`netlify.toml` is already in the repo:
```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

Steps to deploy:
1. Push to GitHub (`phoenix06sa/tstat`)
2. Go to app.netlify.com → Add new site → Import from GitHub → find `tstat`
3. Build settings auto-fill from netlify.toml
4. No environment variables needed — all data is fetched server-side from public AES endpoints

---

## What To Do Next Season

### Step 1: Find the new tournament IDs
When the 2026-2027 season tournament is posted, get the AES results URL and extract:
- EVENT_ID (in the URL path)
- DIV_ID (changes when you click your division)
- TEAM_CODE (search the plays API for your team)
- TEAM_ID (numeric, from the same plays API)

### Step 2: Update the constants in route.ts
```typescript
// In app/api/tournament/route.ts and app/api/teams/route.ts
const EVENT = 'YOUR_NEW_EVENT_ID';
const DIV = 'YOUR_NEW_DIV_ID';
```

Also update the date strings in the API calls:
```typescript
aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-09`),  // → update date
aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-10`),  // → update date
```

### Step 3: Update the finish range map if bracket structure changes
The `sundayFinishRanges` map in `route.ts` is hardcoded to the 2026 Lone Star bracket structure (64 teams, Gold/Silver/Bronze/Flight). If next year's tournament has a different structure, update those ranges. The bracket names (Gold, Silver A-D, etc.) may be the same — check the `/plays/{sunday_date}` response to confirm.

### Step 4: Update the default team code
```typescript
// In app/page.tsx
const DEFAULT_TEAM = 'g14askyl2ls';  // → update to next year's team code
```

### Step 5: Test before the tournament
Run the dev server and point it at the new event. Pool play data usually populates a few days before the tournament when schedules are finalized. Verify:
- All 4 bracket path cards show (means the Saturday bracket Roots are populated)
- The pool standings table shows your team
- The team dropdown has your team in it

### Future enhancement (already planned)
Eventually integrate this into the main Austin Select Volleyball site (`austin-select-volleyball` on Netlify). The idea is to have a tournament tracker section that auto-populates based on the season schedule posted each year — staff enters the AES event URL once and the whole thing auto-fills from there. The AES API pattern is well documented above.

---

## Things That Tripped Us Up (Don't Repeat These)

1. **Turbopack on ARM Mac** — crashes immediately. Always use `--webpack`.

2. **`/schedule/future` API changes meaning after pool play** — before pool play it shows Saturday bracket paths; after it shows Sunday bracket paths directly. We had to detect the current stage and handle both.

3. **Seed text (`1st-P5`) gets replaced with real team names after pool play** — can't rely on regex matching seed text once the tournament progresses. Use `FirstTeam.Code` / `SecondTeam.Code` for stable matching.

4. **`/schedule/current` only shows the active play** — after pool play ends, it only shows the bracket match, not the pool matches. We added `/schedule/past` to always show completed matches regardless of stage.

5. **3rd/4th place paths are never in `/schedule/future`** — the API omits them entirely. We derive them from the Sunday bracket tree by searching for the team's name text.

6. **Sunday bracket `Teams` array is empty until Saturday night** — AES seeds Sunday brackets after Saturday evening results are finalized. The page handles this gracefully (shows bracket names, no teams yet).

7. **Silver A/B/C/D are equal tier** — the letter suffix is purely organizational (4 groups of 4 teams on different courts), not a ranking. Don't label Silver D as "worse" than Silver A.

8. **Gold bracket is 16 teams, NOT 8** — all 16 Saturday challenge bracket winners go to Gold. The 8 "final" matches shown in the Roots are the quarterfinal round of a full 16-team bracket.

9. **The bracketOpponentPoolMap (from sampling future API per pool) became unreliable after pool play** — we replaced it with direct bracket Roots matching by team code.

10. **Function declarations inside `try` blocks fail TypeScript strict mode** — use `const fn = () => {}` syntax instead of `function fn() {}` inside the route handler.

---

## Past Tournament Results Page

We built a second page at `/previous` that shows results from the prior week's tournament (Salt Lake City Showdown, May 1-3, 2026) in the same visual style as the live tracker. This taught us several important things.

### How past tournaments work on the AES API

**What still works on past/completed tournaments:**
- `/schedule/past` returns ALL completed matches with full scores, WIN/LOSS, set scores — this is the primary data source and works perfectly regardless of how old the tournament is
- `/plays/{date}` returns pool standings with `FinishRank`, `MatchesWon`, etc. — fully populated once complete
- Saturday bracket `Roots` still have real team names and match results

**What does NOT work on past tournaments:**
- `/schedule/current` — empty, no current match
- `/schedule/future` — empty, no future matches
- Day 3 (final day) `Teams` arrays in bracket plays are empty — AES clears them after the event. Can't determine exact final rank from bracket data alone.
- Work/ref assignments are also gone

**Workaround for final placement:** Derive it from the last entry in `/schedule/past`. The final match's `Play.FullName` tells you which bracket they played in (e.g. "Gold Bracket"). Exact rank within the bracket is not recoverable without cross-referencing all bracket match results — we didn't build that, we just show "Top 16 in Gold Bracket".

### Salt Lake City Showdown — Different Structure From Lone Star

This was a **3-day, 62-team** tournament with a very different format:

- **Day 1 (Thu May 1):** 3-team pools (only 2 matches each) + "Cross Bracket" play evening
- **Day 2 (Fri May 2):** Re-pooling — teams re-seeded into NEW 4-team pools based on Day 1 results
- **Day 3 (Sat May 3):** Final brackets — Gold, Silver A/B, Bronze A/B, Flight 1A/B, Flight 2A/B, Flight 3A/B, Flight 4

Key differences from Lone Star (2-day, 64-team):
- 3 days instead of 2
- "Cross Bracket" on Day 1 evening (not "Challenge Bracket")
- Re-pooling on Day 2 — teams play in a completely new pool based on Day 1 finish
- Different bracket tier names on Day 3 (Flight 2, 3, 4 instead of just Flight 1A-D)
- 3-team pools on Day 1 means only 2 pool matches (not 3)

**Our result:** 5W–2L overall. Pool 15 Day 1 → 1st. Cross Bracket win. Pool 1 Day 2 → 2nd. Gold Bracket Day 3 → loss first round. Finished top-16 out of 62.

### What This Confirms About API Generalizability

`/schedule/past` is rock solid — returned clean data for all 7 matches across 3 days without any special handling. This is the most reliable endpoint and will work on any AES tournament past or present.

The bracket structure (tier names, number of days, re-pooling format) varies significantly between tournaments. Do not assume next year's tournament matches either of these two. Always pull `/plays/{date}` first and inspect the bracket names and structure before building any logic.

### New Files Added

```
app/api/previous/route.ts   — fetches Salt Lake City Showdown data, returns structured JSON
app/previous/page.tsx       — renders the results page (same dark UI, no auto-refresh)
```

The `/previous` page is linked from the main page footer. Static (no auto-refresh needed, tournament is complete). Cached at 1-hour revalidation since the data never changes.

---

## 2026 Lone Star Regionals — Our Results

Team: Austin Skyline 14 Black (g14askyl2ls)  
Pool: 5 (GRB Court 12)  
Pool opponents: TW Skyline 14 Royal, United VBA 14 Purple, Roots 14-2 Blue

Pool results (1-2 record, 2nd place via set tiebreaker):
- Match 2 vs Roots 14-2 Blue: LOSS (25-19, 22-25, 10-15)
- Match 4 vs United VBA 14 Purple: WIN (26-24, 26-24)
- Match 6 vs TW Skyline 14 Royal: LOSS (12-25, 16-25)

Challenge Bracket #6 (Saturday evening, 6:30 PM, GRB Ct 7):
- vs Austin Skyline 14 Royal (1st from Pool 6)
- *(result TBD at time of writing — tournament still in progress)*

---

*These notes were generated by Hermes Agent during the build session on May 8-9, 2026. Update the "Our Results" section after the tournament concludes.*

---

## Sunday Bracket: Championship Path Display

The most complex UI challenge was making the Sunday bracket readable on a phone. The Gold bracket has 32 total matches (16 teams × 4 rounds, everyone plays all day for placement 1st–16th). A traditional bracket diagram is unusable on a phone. What we built instead:

### How the bracket tree works

The bracket data comes from `/plays/{date}` as a nested `Roots` tree. Each root node has `TopSource` and `BottomSource` that recursively trace back to the first-round matchups. We collect all unique matches by MatchId, tagged with a depth level (depth 0 = final round, max_depth = round 1).

**The key insight for finding the championship path:** recursively check if a match's full ancestor tree contains zero "Loser of..." references — that gives you the pure winners path. Then BFS backward from championship → Semis → Quarters → Round of 16.

### Team name resolution across multiple rounds

AES populates team slots one round ahead. After Round of 16 is played, Quarterfinal nodes get `FirstTeam`/`SecondTeam` objects but `HasScores=false`. After Quarterfinals, Semifinal slots still say "Winner of Match 9" with null `FirstTeam`. This means a single-level lookup isn't enough.

**Solution:** a second-pass iterative resolution loop after collecting all matches. For any match still showing "Winner of...", check if the source match has `HasScores=true`, then use that match's resolved winner. Loop until no more changes (handles R16→QF→Semi→Championship chains in 3-4 iterations). This guarantees all rounds fill in correctly as the day progresses, automatically, on every 90-second refresh.

Everything NOT on that path = placement matches (3rd–16th place). Those show separately at the bottom.

### Round labels by bracket size

```
stagesFromFinal = 0  →  Championship
stagesFromFinal = 1  →  Semifinals
stagesFromFinal = 2  →  Quarterfinals
stagesFromFinal = 3+ →  Round of {2^(stagesFromFinal+1)}
```

Works for any bracket size automatically. Silver D (4 teams) = Semifinal → Final. Gold (16 teams) = Round of 16 → Quarters → Semis → 🏆 Championship.

The UI shows each stage in order top-to-bottom with color-coded dividers (green = winners path, gold = championship). Our team gets a star and yellow border. Placement matches at the bottom are dimmed so the main story is clear.

### Critical gotcha: /schedule/future returns 204 after bracket play starts

Once a team enters Sunday bracket play, `/schedule/future` returns **HTTP 204 No Content** (empty body). Calling `res.json()` on an empty body throws `SyntaxError: Unexpected end of JSON input` — this was the Netlify 500 error. Fix in the `aes()` helper:

```typescript
if (!res.ok || res.status === 204) return null;
const text = await res.text();
if (!text || text.trim() === '') return null;
try { return JSON.parse(text); } catch { return null; }
```

Apply this pattern to every AES fetch. The local dev server masked this bug because Next.js dev mode handles certain errors differently than Netlify's production runtime.

---

## Netlify Deployment: What Was Needed

Several fixes were required — none obvious until you hit them:

1. **`next build --webpack`** in package.json build script — `next build` without it tries Turbopack, which fails on Netlify's Linux build server (same ARM native binding issue as local Mac dev)
2. **`export const dynamic = 'force-dynamic'`** in every API route file — prevents Next.js from statically pre-rendering API routes at build time
3. **`export const maxDuration = 30`** in every API route file — extends Netlify's serverless function timeout beyond the 10-second default
4. **`@netlify/plugin-nextjs` in devDependencies** — must be in package.json, not just referenced in netlify.toml, or Netlify won't install it
5. **`node_bundler = "nft"` in netlify.toml** — correct bundler for Next.js App Router
6. **204/empty JSON handling** — the actual runtime 500 cause once the build was fixed

The `/api/teams` endpoint worked on Netlify while `/api/tournament` failed — which helped isolate the 204 issue as the culprit (teams doesn't call `/schedule/future`, tournament does).

---

## What Was Removed / Simplified

**"Sunday Final Brackets" overview section** — removed. This was an early placeholder that listed all 13 Sunday bracket names and showed team seedings when populated. It was superseded entirely by the active Sunday bracket view (championship path display). AES also clears the `Teams` arrays from bracket plays after the tournament, so it would have been empty after the fact anyway. The active Sunday bracket section — which shows Round of 16 → Quarters → Semis → Championship with actual match cards, scores, and placement matches — does everything that section was supposed to do, and does it better.

**Lesson:** build the overview placeholder early to understand the data, replace it with the real view once you understand the structure well enough to build it properly.

---

## Final Page Structure (as of end of 2026 Lone Star Regionals)

Sections in order, top to bottom:

1. **Sticky header** — team name, pool, team dropdown, refresh button, last-updated timestamp
2. **Event info** — tournament name, venue, dates, division
3. **Pool standings** — table with W/L, sets, rank, tiebreaker note for tied teams
4. **Pool matches** — match cards with scores, WIN/LOSS badges (from `/schedule/past` + `/schedule/current`)
5. **Work/ref assignments** — from `/schedule/work`
6. **Bracket play** — 4 cards (one per pool finish position), showing team at that rank, bracket name, opponent, scores if played, and Win/Lose → Sunday destination with finish range out of 64
7. **Sunday bracket** — championship path (Round of 16 → Quarters → Semis → 🏆 Championship) + placement matches below. Only appears once team is in a Sunday bracket (`/schedule/current` play type = 1 pointing to a day2 bracket)
8. **Footer** — team code, division, link to previous tournament page

---

## Why Our Finish Range Predictions Were Wrong (Important Lesson)

We initially predicted Silver = 17th–20th out of 64. Austin Skyline 14 Black actually finished ~25th. Here's why and what to fix next year.

### The mistake: Silver A-D are NOT the same "slot"

We assumed all 4 Silver brackets were the same tier and would all produce ranks 17–20. **That was wrong.** The correct model:

- Gold: ranks 1–16 (16 teams)
- Silver A–D combined: ranks 17–32 (16 teams total, 4 per bracket)
- Bronze A–D combined: ranks 33–48
- Flight 1A–1D combined: ranks 49–64

Within each Silver bracket (4 teams, 3 matches: 2 semis + 1 final, **no 3rd place match**):
- Won final = top end of Silver tier (~17th–20th depending on A/B/C/D position)
- Lost final = mid Silver (~21st–24th)
- Lost semi = lower Silver (~25th–32nd) — this is where we landed

**Additionally:** Silver D is NOT the same as Silver A. AES assigns the bracket letter based on which challenge brackets feed into it. Silver A gets the "better" challenge bracket losers (from ChBrkt#1-4), Silver D gets the "worse" ones (ChBrkt#13-16 area). So Silver D semi-finalist = closer to 32nd than 25th.

### Corrected finish range predictions

| Your pool finish | Saturday result | Sunday bracket | Best case | Worst case |
|---|---|---|---|---|
| 1st or 2nd | Win Sat bracket | Gold | 1st | 16th |
| 1st or 2nd | Lose Sat bracket | Silver A–D | 17th | 32nd |
| 1st (won ChBrkt#1-4) | Lose | Silver A or B | ~17th | ~24th |
| 2nd (lost ChBrkt#6) | Lose | Silver C or D | ~25th | ~32nd |
| 3rd in pool | (no Sat game) | Bronze A–D | 33rd | 48th |
| 4th in pool | (no Sat game) | Flight 1A–1D | 49th | 64th |

### The app now shows

1. **Bracket path cards** — finishRange now correctly spans the full Silver tier (17th–32nd) rather than just 17th–20th for all Silver brackets
2. **Final Result banner** — appears at the top once all bracket play is done, showing the estimated range based on actual bracket wins. For Silver D semi-finalist (0 bracket wins) = 25th–32nd.

### What we still don't know

AES doesn't publish an official overall numeric rank through the API after the tournament (the `overallRank` field is always null). The "25th place" figure comes from the AES UI doing internal calculation we can't access via API. Our estimated range of 25th–32nd is correct as a range. Getting an exact number would require either:
1. AES publishing it (they do on the UI but not via API)
2. Counting all teams ahead of you manually (feasible but complex to automate)

---

## 2026 Lone Star Regionals — Final Results

Austin Skyline 14 Black (g14askyl2ls):
- Pool 5 (GRB Ct 12): 2nd place (1-2, set % tiebreaker)
- Challenge Bracket #6: LOSS vs Austin Skyline 14 Royal (17-25, 19-25)
- Silver D Bracket semi: LOSS vs STVA 14-1 Alyssa (7-25, 15-25)
- **Final: ~25th–32nd out of 64** (Silver D semi-finalist)

Austin Skyline 14 Royal (g14askyl1ls):
- Pool 6: 1st place (3-0)
- Challenge Bracket #5: WIN
- Gold Bracket: Round of 16 WIN vs Roots 14-1 Green (25-23, 12-25, 15-13), then Quarterfinals vs AP 14 adidas
