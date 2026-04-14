import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "static.mercdn.net",
      },
      {
        protocol: "https",
        hostname: "assets.mercari-shops-static.com",
      },
      {
        protocol: "https",
        hostname: "media.bunjang.co.kr",
      },
      {
        protocol: "https",
        hostname: "shopping-phinf.pstatic.net",
      },
      {
        protocol: "https",
        hostname: "image.production.fruitsfamily.com",
      },
    ],
  },
};

export default nextConfig;
