import type { NextConfig } from "next";

// A unique id per deploy. Netlify sets COMMIT_REF at build time; fall back to
// the build timestamp for local/other builds. Baked into both the client bundle
// and server code (via `env`) so the running client can tell when a newer
// deploy is live and reload itself (see app/page.tsx).
const BUILD_ID = process.env.COMMIT_REF || String(Date.now());

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    // Always revalidate the app shell so a new deploy is picked up on the next
    // load instead of being pinned by an aggressive cache (notably iOS
    // "Add to Home Screen", which caches the shell hard). Hashed assets under
    // /_next/static keep their long-lived immutable caching — that's set by
    // Next and isn't touched here.
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {
        source: '/setup',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
