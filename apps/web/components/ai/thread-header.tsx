"use client"
import { useMutation } from "convex/react"
import { Archive, Loader2, MoreHorizontal, Pencil, ShieldAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { aiApi } from "@/lib/ai/api"
import type { ThreadView } from "@/lib/ai/types"
import { useT } from "@/lib/i18n/client"
import { useAiAgents } from "./ai-context"

const TITLE_MAX = 120

/** Conversation title (rename in place), agent name, live status and the actions menu. */
export function ThreadHeader({ thread, leading }: { thread: ThreadView | null | undefined; leading?: ReactNode }) {
  const { t } = useT()
  const router = useRouter()
  const agents = useAiAgents()
  const rename = useMutation(aiApi.renameThread)
  const archive = useMutation(aiApi.archiveThread)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const agent = thread ? agents?.find((a) => a.id === thread.agentId) : undefined
  const title = thread?.title || t("ai.untitled")

  function startEdit() {
    setDraft(thread?.title ?? "")
    setEditing(true)
  }

  async function save() {
    const next = draft.trim()
    setEditing(false)
    if (!thread || !next || next === thread.title) return
    await run(() => rename({ threadId: thread.id, title: next }), { success: t("ai.renamed") })
  }

  async function doArchive() {
    if (!thread) return
    const ok = await run(() => archive({ threadId: thread.id }), { success: t("ai.archived") })
    if (ok !== undefined) router.push("/app/ai")
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-6">
      {leading}
      <div className="grid min-w-0 flex-1">
        {thread === undefined ? (
          <Skeleton className="h-4 w-48" />
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Input
              autoFocus
              value={draft}
              maxLength={TITLE_MAX}
              aria-label={t("ai.rename.label")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false)
              }}
              className="h-8 max-w-md"
            />
          </form>
        ) : (
          <>
            <h2 className="truncate text-sm font-semibold" title={title}>
              {title}
            </h2>
            {agent && <p className="truncate text-xs text-muted-foreground">{agent.name}</p>}
          </>
        )}
      </div>
      {thread?.status === "running" && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("ai.status.running")}
        </span>
      )}
      {thread?.status === "waiting-approval" && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <ShieldAlert className="size-3.5" />
          {t("ai.status.waiting-approval")}
        </span>
      )}
      {thread && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("ai.actions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={startEdit}>
              <Pencil />
              {t("ai.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void doArchive()}>
              <Archive />
              {t("ai.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
