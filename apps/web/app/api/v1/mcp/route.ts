// MCP server for automations (n8n): `Authorization: Bearer dsk_…`, stateless Streamable HTTP.
// Every assistant tool the key's roles allow (lib/tool-gateway.ts, convex/toolGateway.ts).
import { toolGatewayRoutes } from "@/lib/tool-gateway-server"

export const dynamic = "force-dynamic"
export const { GET, POST, DELETE, OPTIONS } = toolGatewayRoutes.mcp
