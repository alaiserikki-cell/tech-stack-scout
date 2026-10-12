import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return [
      { source: "/watchlist", destination: "/dashboard", permanent: false },
      { source: "/system", destination: "/activity", permanent: false },
      { source: "/costs", destination: "/activity", permanent: false },
      { source: "/how-it-works", destination: "/", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
