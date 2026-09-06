import type { NextConfig } from "next";

/**
 * `next build` and `next dev` share `.next` by default, so producing a
 * production build while the dev server is running rewrites the compiled
 * output underneath it. Every Server Action id is regenerated, and any browser
 * tab still open then posts an id the server no longer knows:
 *
 *   Failed to find Server Action "…". This request might be from an older or
 *   newer deployment.
 *
 * Giving the production build its own directory keeps the two isolated, so a
 * build can no longer break a running dev session.
 */
const distDir = process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "production" ? ".next-build" : ".next");

const nextConfig: NextConfig = {
  distDir,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
