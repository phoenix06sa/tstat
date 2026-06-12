# Tournament Tracker (tstat)

Live volleyball tournament tracker for any AES (Advanced Event Systems) event. Follow one team through a tournament weekend: pool standings, match scores, bracket paths, live bracket play, and final standings.

- Paste any AES results URL on the `/setup` page — no code changes per tournament
- Mobile-friendly dark UI, auto-refreshes every 90 seconds
- Handles 2-day and 3-day formats, re-pooling, challenge/cross brackets, and direct-to-bracket events
- Shareable URLs (`/?event=…&division=…&team=…`) and a saved-tournaments switcher

## Setup a tournament

1. Open `/setup`
2. Paste the AES URL, e.g. `https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview`
3. Pick your team from the dropdown

## Dev

```bash
npm install
npm run dev   # http://localhost:3000 (webpack — Turbopack crashes on ARM Mac)
```

## Code layout

```
app/
├── page.tsx                  # Main tracker UI
├── setup/page.tsx            # Event URL + team configuration
└── api/
    ├── tournament/route.ts   # Main data API (thin orchestrator)
    ├── teams/route.ts        # Team list for the dropdown
    └── event-info/route.ts   # Lightweight event name lookup
lib/
├── aes.ts                    # Shared AES API helpers
└── tournament/               # Typed processing modules (standings, matches,
                              # bracket paths, active bracket, final standings)
```

## Deploy (Netlify)

Auto-deploys from `main` on GitHub (`phoenix06sa/tstat`). Build settings come from `netlify.toml`. No env vars needed — data is fetched server-side from public AES endpoints.

## Docs

- `NOTES.md` — AES API reference and hard-won platform knowledge
- `CHANGELOG-*.md` — per-session build logs (newest has the current architecture)
