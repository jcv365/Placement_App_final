import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: false,
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
};

export default nextConfig;
