import { McpPermissions } from "@digimuza/system-core/mcp"
import { McpSiteUrlProvider } from "@/components/ai/mcp/mcp-context"
import { getPublicEnv } from "@/env"
import { requireSession } from "@/lib/system-server"
import { McpView } from "./mcp-view"

/**
 * AI integrations (secondary place; the main entry points are in /app/ai): connect
 * ChatGPT / Claude with a one-time link, list and revoke connections.
 */
export default async function McpPage() {
  await requireSession({ permission: McpPermissions.create })
  return (
    <McpSiteUrlProvider siteUrl={getPublicEnv().SITE_URL}>
      <McpView />
    </McpSiteUrlProvider>
  )
}
