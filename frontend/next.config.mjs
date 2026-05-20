import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pnpm workspace: node_modules live at the workspace root, one level up.
  // Without this, Next.js standalone file-tracing stops at frontend/ and
  // misses the `next` package, causing MODULE_NOT_FOUND at runtime.
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
