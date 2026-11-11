// MCP server (/mcp/c/<code>) and OAuth endpoints (/mcp/oauth/*) for ChatGPT and Claude.
import { mcpRoutes } from "@/lib/mcp-routes"

export const dynamic = "force-dynamic"
export const { GET, POST, DELETE, OPTIONS } = mcpRoutes
