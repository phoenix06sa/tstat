import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure API routes are always dynamic (never statically cached at build)
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
