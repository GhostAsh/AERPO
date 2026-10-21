import type { NextConfig } from "next";

const optimizerDevOrigin = (
  process.env.OPTIMIZER_DEV_ORIGIN ?? "https://aerpo.vercel.app"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }

    return [
      {
        source: "/api/optimizer/:path*",
        destination: `${optimizerDevOrigin}/api/optimizer/:path*`,
      },
    ];
  },
};

export default nextConfig;
