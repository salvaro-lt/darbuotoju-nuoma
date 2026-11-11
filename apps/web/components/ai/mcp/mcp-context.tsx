"use client"
import { McpPermissions } from "@digimuza/system-core/mcp"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { AI_CHAT_PERMISSION } from "@/lib/ai/api"

export const MCP_MODULE_ID = "mcp"

const SiteUrlContext = createContext<string | null>(null)

/**
 * SITE_URL for connection links (it is the OAuth issuer the clients check).
 * Server layouts pass `getPublicEnv().SITE_URL`.
 */
export function McpSiteUrlProvider({ siteUrl, children }: { siteUrl: string; children: ReactNode }) {
  return <SiteUrlContext.Provider value={siteUrl.replace(/\/+$/, "")}>{children}</SiteUrlContext.Provider>
}

const noSubscribe = () => () => {}

/** The provided SITE_URL, else the page's origin. */
export function useMcpSiteUrl() {
  const provided = useContext(SiteUrlContext)
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "")
  return provided ?? origin
}

/**
 * Who sees the MCP entry points: the `mcp` module on, and both `ai:chat:use`
 * and `mcp:connection:create` (UI hint; Convex re-checks).
 */
export function useMcpAccess() {
  const enabled = useVisibleModules().some((m) => m.id === MCP_MODULE_ID && m.effective)
  const canChat = useCan(AI_CHAT_PERMISSION)
  const canCreate = useCan(McpPermissions.create)
  const canManage = useCan(McpPermissions.manage)
  return { enabled, canConnect: enabled && canChat && canCreate, canManage: enabled && canManage }
}
