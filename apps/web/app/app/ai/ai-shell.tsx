"use client"
import { useVisibleModules } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { useParams } from "next/navigation"
import type { ReactNode } from "react"
import { AiAgentsProvider } from "@/components/ai/ai-context"
import { AiThreadList } from "@/components/ai/thread-list"
import { AI_MODULE_ID, aiApi } from "@/lib/ai/api"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

/**
 * Full-bleed workspace. Desktop: conversation rail on the left, chat filling the
 * rest. Phone: the list alone on /app/ai, the chat alone on /app/ai/[threadId]
 * (list in a Sheet there).
 */
export function AiShell({ children }: { children: ReactNode }) {
  const { t } = useT()
  const enabled = useVisibleModules().some((m) => m.id === AI_MODULE_ID && m.effective)
  const agents = useQuery(aiApi.listAgents, enabled ? {} : "skip")
  const { threadId } = useParams<{ threadId?: string }>()

  if (!enabled) return <p className="p-8 text-sm text-muted-foreground">{t("ai.disabled")}</p>

  return (
    <AiAgentsProvider value={agents}>
      {/* Viewport height minus the phone header (3rem) / the inset sidebar's margin (1rem). */}
      <div className="flex h-[calc(100svh-3rem)] min-h-96 overflow-hidden md:h-[calc(100svh-1rem)]">
        <aside aria-label={t("ai.threads")} className={cn("w-full min-w-0 flex-col md:flex md:w-72 md:shrink-0 md:border-r lg:w-80", threadId ? "hidden" : "flex")}>
          <AiThreadList activeId={threadId} />
        </aside>
        <section className={cn("min-w-0 flex-1 flex-col", threadId ? "flex" : "hidden md:flex")}>{children}</section>
      </div>
    </AiAgentsProvider>
  )
}
