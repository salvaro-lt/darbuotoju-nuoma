// OAuth discovery for the MCP server: oauth-protected-resource (RFC 9728),
// oauth-authorization-server (RFC 8414) and openid-configuration. Unknown paths 404.
import { mcpRoutes } from "@/lib/mcp-routes"

export const dynamic = "force-dynamic"
export const { GET, OPTIONS } = mcpRoutes
