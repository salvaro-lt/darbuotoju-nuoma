import type { ReactNode } from "react"
import { McpSiteUrlProvider } from "@/components/ai/mcp/mcp-context"
import { getPublicEnv } from "@/env"
import { AiShell } from "./ai-shell"

// Thread list + chat. Each page checks ai:chat:use; Convex re-checks every call.
// SITE_URL: the base of MCP connection links (the OAuth issuer ChatGPT / Claude check).
export default function AiLayout({ children }: { children: ReactNode }) {
  return (
    <McpSiteUrlProvider siteUrl={getPublicEnv().SITE_URL}>
      <AiShell>{children}</AiShell>
    </McpSiteUrlProvider>
  )
}
