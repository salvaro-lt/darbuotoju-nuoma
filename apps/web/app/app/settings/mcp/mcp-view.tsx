"use client"
import { useState } from "react"
import { ConnectMcpButton } from "@/components/ai/mcp/connect"
import { McpConnectionsTable } from "@/components/ai/mcp/connections"
import { useMcpAccess } from "@/components/ai/mcp/mcp-context"
import { PageHeader } from "@/components/app/page-header"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n/client"

/**
 * AI integrations: the same pieces as the AI assistant's connections sheet
 * (components/ai/mcp), plus everyone's connections for mcp:connection:manage.
 */
export function McpView() {
  const { t } = useT()
  const { enabled, canManage } = useMcpAccess()
  const [scope, setScope] = useState<"mine" | "all">("mine")

  return (
    <>
      <PageHeader title={t("mcp.title")} lead={t("mcp.lead")} actions={<ConnectMcpButton />} />
      {!enabled && <p className="mb-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("mcp.disabled")}</p>}
      {canManage && (
        <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")} className="mb-4">
          <TabsList>
            <TabsTrigger value="mine">{t("mcp.connections")}</TabsTrigger>
            <TabsTrigger value="all">{t("mcp.allConnections")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <McpConnectionsTable scope={scope} emptyAction={scope === "mine" ? <ConnectMcpButton /> : undefined} />
    </>
  )
}
