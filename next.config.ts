import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // PGlite loads its Postgres/PostGIS WASM from its own package directory at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-postgis"],
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
