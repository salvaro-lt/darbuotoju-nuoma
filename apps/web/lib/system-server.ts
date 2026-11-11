import "server-only"
import { createSystemServerClient, toSystemError } from "@digimuza/system-core/next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { getPublicEnv } from "@/env"
import { getToken } from "./auth-server"

/**
 * Typed, traced Convex client for Server Components, Route Handlers and Server
 * Actions. Forwards the WorkOS access token so Convex resolves the same
 * actor. Convex still checks every permission itself.
 */
export async function systemServer() {
  return createSystemServerClient({
    getToken: () => getToken(),
    headers: await headers(),
    url: getPublicEnv().CONVEX_URL,
  })
}

export type SessionSummary = Awaited<ReturnType<typeof loadSession>>

export async function loadSession() {
  const client = await systemServer()
  try {
    // A Super previewing a role gets that role's session (system-core view as role).
    return await client.query(api.system.session, { operationId: client.operationId })
  } finally {
    client.end()
  }
}

/**
 * Server-side guard for pages. Redirects anonymous visitors to /login, and
 * signed-in identities without a system account to /login?state=no-access.
 * Pass `permission` to also require it (UI routing only; the Convex functions
 * the page calls re-check).
 */
export async function requireSession(options: { permission?: string } = {}) {
  if (!(await getToken())) redirect("/login")
  const session = await loadSession()
  if (!session.actor || session.actor.kind !== "user") redirect("/login?state=no-access")
  if (options.permission && !session.actor.isSuper && !session.permissions.includes(options.permission)) redirect("/app?denied=1")
  return { ...session, actor: session.actor }
}

/** `{ code, operationId }` from any failed call, safe to show to the user. */
export function publicError(e: unknown) {
  const se = toSystemError(e)
  return { code: se?.code ?? "UNAVAILABLE", operationId: se?.operationId ?? null }
}
