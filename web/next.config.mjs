/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_BASE_URL || "http://127.0.0.1:8000";

const nextConfig = {
  async rewrites() {
    // Single-origin for the judges' browser: /api/* is proxied to FastAPI
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
