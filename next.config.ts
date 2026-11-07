import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev badge (bottom left). Errors still show in development.
  devIndicators: false,
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
