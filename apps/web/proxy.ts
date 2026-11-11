import { authkitProxy } from "@workos-inc/authkit-nextjs"
import type { NextFetchEvent, NextRequest } from "next/server"
import { getPublicEnv } from "@/env"

// AuthKit session handling (cookie refresh, headers for withAuth()). It does not
// guard pages: app/app/layout.tsx and Convex do. Built on first request because
// SITE_URL is runtime config (one image, many environments).
let handler: ReturnType<typeof authkitProxy> | null = null

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  handler ??= authkitProxy({
    redirectUri: `${getPublicEnv().SITE_URL.replace(/\/+$/, "")}/callback`,
    middlewareAuth: { enabled: false, unauthenticatedPaths: [] },
  })
  return handler(request, event)
}

export const config = {
  // Everything except static assets, the health probe, the API-key endpoints, the
  // automation webhooks and the MCP server with its OAuth discovery (never with a session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health|api/v1|api/automations|api/ingest|mcp/|\\.well-known/).*)"],
}
