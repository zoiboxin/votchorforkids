import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The dev-tools bubble sits bottom-left by default and covers the in-game
  // food hotbar (players thought the inventory was broken / only 1 slot).
  devIndicators: false,
  // the preview iframe loads the app from a *.space-z.ai origin — allow its
  // dev asset requests (Next 16 dev-only notice)
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
