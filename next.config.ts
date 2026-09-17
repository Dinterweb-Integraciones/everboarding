import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // The persistent on-disk Turbopack cache (default on since Next 16.1)
    // has been serving stale compiled output across dev-server restarts in
    // this project — likely because it lives inside a OneDrive-synced
    // folder, which interferes with the file-change detection the cache
    // relies on to know when to invalidate. Disabling it trades some
    // rebuild speed for correctness: every `next dev` start recompiles from
    // scratch instead of trusting a cache that isn't reliably invalidated.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
