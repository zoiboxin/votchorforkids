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
};

export default nextConfig;
