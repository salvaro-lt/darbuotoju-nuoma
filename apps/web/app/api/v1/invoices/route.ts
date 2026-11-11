import { createAgentClient, toSystemError } from "@digimuza/system-core/next"
import { z } from "zod"
import { api } from "@/convex/_generated/api"
import { getPublicEnv } from "@/env"

export const dynamic = "force-dynamic"

/**
 * Agent endpoint: `Authorization: Bearer dsk_…`. The key is passed to Convex
 * as `apiKey`; Convex resolves the agent, caps it by the owner's current
 * permissions and checks the module is enabled. Nothing is decided here.
 *
 *   curl -H "Authorization: Bearer $KEY" $SITE/api/v1/invoices
 */
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, UNAVAILABLE: 503 }

function agent(req: Request) {
  const apiKey = req.headers.get("authorization")?.match(/^Bearer (dsk_\S+)$/)?.[1]
  return apiKey ? createAgentClient({ url: getPublicEnv().CONVEX_URL, apiKey }) : null
}

function errorResponse(e: unknown) {
  const se = toSystemError(e)
  if (!se) return Response.json({ code: "UNAVAILABLE" }, { status: 503 })
  return Response.json({ code: se.code, operationId: se.operationId ?? null }, { status: STATUS[se.code] ?? 500 })
}

export async function GET(req: Request) {
  const client = agent(req)
  if (!client) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 })
  try {
    return Response.json({ items: await client.query(api.finance.listInvoices, {}) })
  } catch (e) {
    return errorResponse(e)
  }
}

const createBody = z.object({ number: z.string().min(1), customer: z.string().min(1), amountCents: z.number().int().positive(), currency: z.string().length(3).optional() })

export async function POST(req: Request) {
  const client = agent(req)
  if (!client) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 })
  const body = createBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return Response.json({ code: "VALIDATION", fields: body.error.issues.map((i) => i.path.join(".")) }, { status: 400 })
  try {
    return Response.json(await client.mutation(api.finance.createInvoice, body.data), { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
