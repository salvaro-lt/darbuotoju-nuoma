import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (Coolify). No Vercel.
  output: "standalone",
  // Monorepo: trace files from the workspace root so workspace packages
  // (packages/*) end up in the standalone bundle. The server then lives at
  // .next/standalone/apps/web/server.js.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@digimuza/crm", "@digimuza/documents"],
  poweredByHeader: false,
  serverExternalPackages: [],
}

export default nextConfig
