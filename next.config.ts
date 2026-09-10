import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "notepad-reel.b-cdn.net",
      },
    ],
  },
};

export default nextConfig;
