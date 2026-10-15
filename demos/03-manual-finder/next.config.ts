import type { NextConfig } from "next";

// The Python backend (backend/app.py) serves every /api route; Next.js only
// renders the interface and proxies API calls to it.
const apiUrl = (process.env.MANUAL_API_URL || "http://127.0.0.1:8002").replace(
  /\/$/,
  "",
);

const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
