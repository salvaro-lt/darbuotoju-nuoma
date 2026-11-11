import "server-only"
import { createMcpRoutes } from "@digimuza/system-core/mcp/next"
import { brand } from "@/brand"
import { getPublicEnv } from "@/env"

/**
 * The MCP server and its OAuth endpoints (ChatGPT, Claude). Every path goes
 * through one handler: /mcp/c/<code>, /mcp/oauth/*, /.well-known/oauth-*.
 * SITE_URL is the OAuth issuer and the base of the connection links. Convex
 * decides everything (convex/mcp.ts).
 */
export const mcpRoutes = createMcpRoutes({
  siteUrl: () => getPublicEnv().SITE_URL,
  convexUrl: () => getPublicEnv().CONVEX_URL,
  serverName: `${brand.name} AI`,
})
