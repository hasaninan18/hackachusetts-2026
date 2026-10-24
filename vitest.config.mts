import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only adds the tsconfig "@/*" path alias, so tests can import pages and components that use
// "@/..." imports (e.g. the trial page server component). Everything else stays at Vitest's
// defaults. The pattern only matches "@/...", so scoped packages like "@vercel/functions"
// are untouched.
export default defineConfig({
  resolve: {
    // Replacement ends in "/", so "@/lib/x" becomes "<root>/lib/x" (no double slash).
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
});
