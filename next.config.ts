import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
