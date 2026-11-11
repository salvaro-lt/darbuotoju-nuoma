// POST /api/v1/tools/<tool>: run one assistant tool (id `staffing.list_workers` or name
// `staffing_list_workers`) with an agent key; JSON body = arguments. GET: its definition.
// See lib/tool-gateway.ts.
import { toolGatewayRoutes } from "@/lib/tool-gateway-server"

export const dynamic = "force-dynamic"
export const { GET, POST, OPTIONS } = toolGatewayRoutes.tool
