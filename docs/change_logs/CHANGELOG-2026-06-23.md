# Changelog — June 23, 2026

## Branch: `changes` → `main`

**Context:** Evening session prepping the tracker for our friends on **CTX
Juniors 12 Mizuno** (AAU Girls National Championships – Wave 1, **12 Classic**,
event `PTAwMDAwNDUwMjY90` / division `213733`). Working through that event's
multi-stage Challenge → Division format surfaced bracket-highlighting and
final-standings issues; a separate validation against the **2026 USAV Girls
Junior National Championship 11–13** (event `PTAwMDAwNDE5NTg90` / division
`200246`, **Austin Skyline 12 Royal**) caught a standings bug. Also wired up
Netlify access and a client auto-update mechanism.

---

## 1. Bracket Play: predictions read as predictions; confirm the real landing spot

On-path brackets were highlighted yellow whether or not we'd actually land in
them, with nothing saying *why* — confusing when matchups are still "Winner of
Match 1 vs Winner of Match 4".

- Added a **"◆ Prediction · you could land here"** badge on highlighted brackets
  whose finish isn't decided yet, with a note that matchups resolve as games
  finish.
- New `confirmed` flag in `buildBracketPaths`: set once our pool finish is
  decided and this bracket is our landing spot (plus brackets reachable onward
  via win/lose feeds). Once known, ruled-out brackets revert to **gray** and stop
  highlighting our pool ref inside their predicted trees; the confirmed bracket
  shows a green **"★ Your bracket"** badge.
- Treat the live `activeBracket` as ground truth, so multi-stage Challenge →
  Division formats highlight the division we actually played even when the
  pool → bracket prediction never mapped our finish to it (the AAU Consolation
  Division A case). This also addresses the deferred "`isOurTeamRef` over-broad
  highlighting" note from the June review — per-row highlights now only fire in
  brackets that are still live landing spots.
- Section subtitle flips from "Predicted landing spots highlighted" to "Your
  bracket highlighted" once placement is known.

Files: `lib/tournament/bracket-paths.ts`, `app/page.tsx`.

**Known gap (parked):** multi-stage *forward chaining* doesn't connect for the
AAU event — `chainedPaths` comes back empty, so a division like Consolation
Division A only lights up **after** we play it, not as a pre-play prediction.
`resolveFeed`/`advances` don't recognize how this event's division brackets
reference Challenge results. Deferred until the tournament starts so we can see
the live data shape.

## 2. Challenge Rounds get their own section

Challenge/crossover brackets are stepping stones that decide which division you
land in — they were mixed into Bracket Play.

- Split bracket cards by `finishRange`: intermediates (no final finish rank) go
  into a new **Challenge Rounds** section above the divisions; divisions stay in
  Bracket Play. Card rendering is shared, so highlighting/prediction badges carry
  over unchanged.
- Data-driven, not name-matching — works on any event. The section only appears
  when such brackets exist, and the heading is derived from the event's own naming
  ("Challenge 4" → **Challenge Rounds**, "Crossover 1" → **Crossover Rounds**).

Files: `app/page.tsx`.

## 3. Bug: final standings used seeds as ranks on USAV-style events

Austin Skyline 12 Royal showed **14th**; AES showed **T-9th**. The trailing
`(N)` after each team in the bracket results is an explicit *overall rank* on
some events (Lone Star Regionals) but a *seed* on others (USAV JNCs) — there the
bracket *winner* can carry the worst number (Silver A winner = `(16)`, last place
= `(9)`). We treated `(N)` as a rank unconditionally and emitted seeds as
standings.

- Only trust `(N)` as an overall rank when it's **finish-consistent** (improves as
  bracket finish improves). If any bracket's numbers run backwards, they're seeds
  — ignore them and fall back to the existing elimination-tier ranking, which
  correctly ties sibling-bracket teams (Silver A 1st = Silver B 1st = **T-9th**).
- Result: Austin Skyline → T-9th, matching AES. The T-9th data point also
  confirmed AES ranks by elimination-round ties, so Gold (no placement matches
  played) correctly shows 1, 2, T-3, T-5.
- Verified the AAU 12 Classic event is **byte-for-byte unchanged** (131 teams) —
  it was already correct and stays correct.

Files: `lib/tournament/final-standings.ts`.

## 4. Auto-reload clients when a new deploy is live

Home-screen / bookmarked copies (esp. iOS "Add to Home Screen") cache the app
shell hard — an in-app refresh re-fetched data but never the code, so you had to
kill the app to get a new build.

- Bake a per-deploy `BUILD_ID` (Netlify `COMMIT_REF`, else build timestamp) into
  the bundle via `next.config.ts`, and return the live deploy's id from
  `/api/tournament` (already polled every 90s).
- When the running client's id differs from the live one, its shell is stale —
  `location.reload()`. A `sessionStorage` guard prevents a reload loop.
- Send `Cache-Control: no-cache` on the app shell (`/`, `/setup`) so the reload
  actually revalidates; hashed `/_next/static` assets keep immutable caching.

Note: the auto-updater only exists from this build onward, so an
already-installed shell needs **one** manual kill/reopen to land on it; after
that, future deploys roll in on their own.

Files: `next.config.ts`, `app/api/tournament/route.ts`, `app/page.tsx`.

## 5. Setup: search a team by name across all divisions

When tracking someone else's team you often don't know their division.

- New **"Don't know the division? Search by team name"** option on the division
  step. It searches every division at once and picks the team's division for you;
  each result shows the team with its division (e.g. "12 Classic · g12ctxjr1ls").
- The original "choose division first" flow is unchanged and still the default;
  you can flip back to it anytime.
- Backed by a new `/api/event-teams` endpoint that aggregates teams from all
  divisions in one parallel, cached request. Verified at **934 teams / 14
  divisions** for the AAU event; "CTX Juniors 12 Mizuno" resolves to 12 Classic.

Files: `app/api/event-teams/route.ts` (new), `app/setup/page.tsx`.

## 6. Netlify access + housekeeping

- Linked the project to the `tstat` Netlify site (`tstat.netlify.app`, repo
  `phoenix06sa/tstat`) so deploys can be watched/triggered from the CLI. Confirmed
  the standings/prediction work was already live — the earlier "didn't deploy"
  was a cached home-screen shell, not a failed build.
- `netlify link` added `.netlify` to `.gitignore`.

Files: `.gitignore`.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` succeeds (the `swc-darwin-arm64`
  warnings are the local macOS WASM fallback, irrelevant on Netlify's Linux).
- USAV `200246` / Austin Skyline 12 Royal → **T-9th** (was 14th); AAU `213733`
  standings unchanged across all 131 teams.
- AAU bracket split: **Challenge Rounds** = Challenge 4, 6; **Bracket Play** = 23
  divisions. `/api/event-teams` for AAU returns 934 teams / 14 divisions.
- No new ESLint errors (the remaining `set-state-in-effect` warnings are
  pre-existing).
