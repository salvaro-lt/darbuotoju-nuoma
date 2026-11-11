"use client"
import { Plug, Sparkles } from "lucide-react"
import { CopyMcpLinkButton } from "@/components/ai/mcp/connect"
import { useMcpAccess } from "@/components/ai/mcp/mcp-context"
import { NewThreadButton } from "@/components/ai/thread-list"
import { useT } from "@/lib/i18n/client"

/** Right pane on desktop before a conversation is open (hidden on phones). */
export function AiHome() {
  const { t } = useT()
  const { canConnect } = useMcpAccess()
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="grid max-w-md justify-items-center gap-5 text-center">
        <span className="flex size-11 items-center justify-center rounded-full border bg-background text-primary shadow-sm">
          <Sparkles className="size-5" />
        </span>
        <div className="grid gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{t("ai.pick.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.pick.body")}</p>
        </div>
        <NewThreadButton variant="default" />
        {canConnect && (
          <section className="mt-4 grid w-full justify-items-center gap-3 rounded-xl border bg-card p-5 text-center shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Plug className="size-4" />
            </span>
            <div className="grid gap-1">
              <h3 className="font-semibold">{t("ai.mcp.connect.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("ai.mcp.connect.body")}</p>
            </div>
            <CopyMcpLinkButton variant="default" className="w-full max-w-xs" />
          </section>
        )}
      </div>
    </div>
  )
}
