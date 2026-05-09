# Lone Star Tracker

Live tournament tracker for **Austin Skyline 14 Black** at 2026 Lone Star Regionals.

- Mobile-friendly dark UI
- Auto-refreshes every 90 seconds
- Pulls live data from AES (Advanced Event Systems) API
- Shows pool standings, match scores, work assignments, bracket paths

## Dev

```bash
npm install
npm run dev   # http://localhost:3000
```

## Deploy (Netlify)

Push to GitHub, connect repo to Netlify. Build settings:
- Build command: `npm run build`
- Publish directory: `.next`
- Runtime: Next.js (auto-detected)

No env vars needed — data is fetched server-side from public AES endpoints.
