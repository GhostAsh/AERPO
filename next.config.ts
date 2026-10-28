import type { NextConfig } from "next";

const optimizerDevOrigin = (
  process.env.OPTIMIZER_DEV_ORIGIN || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // A batch can include three ledgers, each with an inference retry. The
  // default 30-second rewrite timeout disconnects while Python is still working.
  ...(process.env.NODE_ENV === "development"
    ? { experimental: { proxyTimeout: 600_000 } }
    : {}),
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
