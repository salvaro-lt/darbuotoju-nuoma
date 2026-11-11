// The app's tool gateway routes (lib/tool-gateway.ts) bound to Convex. Server only:
// app/api/v1/mcp and app/api/v1/tools import it.
import "server-only"
import { ConvexHttpClient } from "convex/browser"
import { brand } from "../brand"
import { api } from "../convex/_generated/api"
import { getPublicEnv } from "../env"
import { createToolGatewayRoutes, type ToolGatewayBackend } from "./tool-gateway"

/** The app's gateway: Convex at CONVEX_URL (runtime config). */
export function convexToolGatewayBackend(url: string): ToolGatewayBackend {
  const client = new ConvexHttpClient(url)
  return {
    listTools: (apiKey) => client.query(api.toolGateway.listTools, { apiKey }),
    // JSON: Convex values reject field names such as n8n node names ("Laiškas iš …") or `$…`.
    callTool: (apiKey, tool, args) => client.action(api.toolGateway.callTool, { apiKey, tool, argsJson: JSON.stringify(args ?? {}) }),
  }
}

let backend: ToolGatewayBackend | null = null
export const toolGatewayRoutes = createToolGatewayRoutes({
  backend: () => (backend ??= convexToolGatewayBackend(getPublicEnv().CONVEX_URL)),
  serverName: `${brand.name} duomenys`,
})
