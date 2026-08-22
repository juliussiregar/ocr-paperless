import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep Turbopack rooted on `app/` so `app/.env.local` is the env source
  // (parent lockfile otherwise makes Next treat the monorepo root as cwd).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
