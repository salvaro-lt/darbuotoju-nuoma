// GET /api/v1/tools: the tools this agent key (`Bearer dsk_…`) may run (lib/tool-gateway.ts).
import { toolGatewayRoutes } from "@/lib/tool-gateway-server"

export const dynamic = "force-dynamic"
export const { GET, OPTIONS } = toolGatewayRoutes.tools
