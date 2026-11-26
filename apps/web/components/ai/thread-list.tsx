"use client"
import { useMutation, useQuery } from "convex/react"
import { Asterisk, Bot, ChevronDown, ChevronRight, Loader2, Plug, ShieldAlert, SquarePen, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { aiApi } from "@/lib/ai/api"
import type { ThreadView } from "@/lib/ai/types"
import { formatDate, formatTime } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { useAiAgents } from "./ai-context"
import { api } from "@/convex/_generated/api"
import { CopyMcpLinkButton } from "./mcp/connect"
import { McpConnectionsSheetButton } from "./mcp/connections"

const PAGE = 30
const DAY = 24 * 60 * 60 * 1000

/** "Naujas pokalbis": creates a thread and opens it. Offers an agent picker when there is more than one agent. */
export function NewThreadButton({ onCreated, className, variant = "outline" }: { onCreated?: () => void; className?: string; variant?: "outline" | "default" }) {
  const { t } = useT()
  const router = useRouter()
  const agents = useAiAgents()
  const create = useMutation(aiApi.createThread)
  const { run, busy } = useAction()

  async function start(agentId?: string) {
    const res = await run(() => create(agentId ? { agentId } : {}))
    if (res) {
      onCreated?.()
      router.push(`/app/ai/${res.threadId}`)
    }
  }

  const icon = busy ? <Loader2 className="animate-spin" /> : <SquarePen />

  if (agents && agents.length > 1) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} disabled={busy} className={className}>
            {icon}
            {t("ai.new")}
            <ChevronDown className="ml-auto" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("ai.agent")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {agents.map((a) => (
            <DropdownMenuItem key={a.id} onSelect={() => void start(a.id)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{a.name}</span>
              {a.description && <span className="text-xs text-muted-foreground">{a.description}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Button variant={variant} disabled={busy} className={className} onClick={() => void start(agents?.[0]?.id)}>
      {icon}
      {t("ai.new")}
    </Button>
  )
}

type Group = "today" | "yesterday" | "week" | "older"
type Connection = { id: string; clientName: string; name: string | null; status: "active" | "revoked"; lastActivityAt: number | null; createdAt: number }

/**
 * Connection focus in the URL (`?connection=<id>` from a group header or the
 * connections list), kept on thread links so it survives navigation.
 */
function useThreadFilter() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const connection = params.get("connection")
  const query = params.toString()
  const go = (q: URLSearchParams) => router.replace(q.size ? `${pathname}?${q}` : pathname)
  const clearConnection = () => go(new URLSearchParams())
  const openConnection = (id: string) => go(new URLSearchParams({ connection: id }))
  return { connection, clearConnection, openConnection, suffix: query ? `?${query}` : "" }
}

/** An icon per external client: ChatGPT / OpenAI, Claude, anything else. */
export function McpClientIcon({ clientName, className }: { clientName: string; className?: string }) {
  const n = clientName.toLowerCase()
  const Icon = n.includes("claude") ? Asterisk : n.includes("chatgpt") || n.includes("openai") ? Bot : Plug
  return <Icon aria-hidden className={cn("shrink-0", className)} />
}

/** Small pill with the external client's name ("ChatGPT", "Claude Code") on MCP threads. */
export function McpClientPill({ clientName, className }: { clientName: string; className?: string }) {
  const { t } = useT()
  return (
    <span
      title={t("ai.mcp.badge").replace("{client}", clientName)}
      className={cn("inline-flex max-w-28 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary", className)}
    >
      <McpClientIcon clientName={clientName} className="size-2.5" />
      <span className="truncate">{clientName}</span>
    </span>
  )
}

function groupOf(ms: number, now: number): Group {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (ms >= today) return "today"
  if (ms >= today - DAY) return "yesterday"
  if (ms >= today - 7 * DAY) return "week"
  return "older"
}

function useWhen() {
  const { locale } = useT()
  const [now] = useState(() => Date.now())
  return (ms: number) => {
    const g = groupOf(ms, now)
    return g === "today" || g === "yesterday" ? formatTime(ms, locale) : formatDate(ms, locale)
  }
}

function ThreadRow({ th, activeId, suffix, onNavigate, pill }: { th: ThreadView; activeId?: string | undefined; suffix: string; onNavigate?: (() => void) | undefined; pill: boolean }) {
  const { t } = useT()
  const when = useWhen()
  const active = th.id === activeId
  return (
    <li>
      <Link
        href={`/app/ai/${th.id}${suffix}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md px-2 text-sm text-foreground/85 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          active && "bg-muted font-medium text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{th.title || t("ai.untitled")}</span>
        {pill && th.mcp && <McpClientPill clientName={th.mcp.clientName} />}
        {th.status === "running" && <Loader2 aria-label={t("ai.status.running")} className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        {th.status === "waiting-approval" && <ShieldAlert aria-label={t("ai.status.waiting-approval")} className="size-3.5 shrink-0 text-primary" />}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{when(th.updatedAt)}</span>
      </Link>
    </li>
  )
}

/** The person's own conversations, grouped by day. */
function MineSection({ activeId, suffix, onNavigate }: { activeId?: string | undefined; suffix: string; onNavigate?: (() => void) | undefined }) {
  const { t } = useT()
  const [limit, setLimit] = useState(PAGE)
  const page = useQuery(aiApi.listThreads, { limit, source: "app" })
  const [now] = useState(() => Date.now())
  if (page === undefined) return <Skeletons />
  const groups: { id: Group; items: ThreadView[] }[] = []
  for (const th of [...page.items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const id = groupOf(th.updatedAt, now)
    const last = groups.at(-1)
    if (last?.id === id) last.items.push(th)
    else groups.push({ id, items: [th] })
  }
  return (
    <section className="pt-3">
      <h2 className="px-2 pb-1 text-xs font-semibold text-foreground/70">{t("ai.group.mine")}</h2>
      {page.items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("ai.filter.empty.app")}</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="pt-1">
            <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{t(`ai.group.${g.id}` as MessageKey)}</h3>
            <ul className="grid gap-px">
              {g.items.map((th) => (
                <ThreadRow key={th.id} th={th} activeId={activeId} suffix={suffix} onNavigate={onNavigate} pill={false} />
              ))}
            </ul>
          </div>
        ))
      )}
      {!page.done && (
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setLimit((l) => l + PAGE)}>
          {t("ai.loadMore")}
        </Button>
      )}
    </section>
  )
}

/** One MCP connection: header (client, label, last activity; click = only its threads) and its newest threads, live. */
function ConnectionSection({ conn, limit, activeId, suffix, onNavigate, onOpen }: { conn: Connection; limit: number; activeId?: string | undefined; suffix: string; onNavigate?: (() => void) | undefined; onOpen?: () => void }) {
  const { t } = useT()
  const when = useWhen()
  const [more, setMore] = useState(0)
  const page = useQuery(aiApi.listThreads, { limit: limit + more, mcpConnectionId: conn.id })
  const items = page ? [...page.items].sort((a, b) => b.updatedAt - a.updatedAt) : undefined
  const header = (
    <>
      <McpClientIcon clientName={conn.clientName} className="size-3.5 text-primary" />
      <span className="min-w-0 flex-1 truncate text-left">
        <span className="font-semibold text-foreground/80">{conn.clientName}</span>
        {conn.name && <span className="font-normal text-muted-foreground"> · {conn.name}</span>}
      </span>
      {conn.lastActivityAt && <span className="shrink-0 font-normal text-muted-foreground tabular-nums">{when(conn.lastActivityAt)}</span>}
      {onOpen && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
    </>
  )
  return (
    <section className="pt-4">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t("ai.mcp.group.open").replace("{client}", conn.clientName)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {header}
        </button>
      ) : (
        <h2 className="flex items-center gap-1.5 px-2 py-1 text-xs">{header}</h2>
      )}
      {items === undefined ? (
        <Skeletons count={2} />
      ) : items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("ai.mcp.group.empty")}</p>
      ) : (
        <ul className="grid gap-px pt-0.5">
          {items.map((th) => (
            <ThreadRow key={th.id} th={th} activeId={activeId} suffix={suffix} onNavigate={onNavigate} pill={false} />
          ))}
        </ul>
      )}
      {!onOpen && page && !page.done && (
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setMore((m) => m + PAGE)}>
          {t("ai.loadMore")}
        </Button>
      )}
    </section>
  )
}

function Skeletons({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-1.5 p-1 pt-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

/**
 * The caller's conversations, live, grouped by source: "My conversations" first,
 * then one group per MCP connection (ChatGPT, Claude Code…) with its newest threads
 * below. A group header narrows the list to that connection.
 */
export function AiThreadList({ activeId, onNavigate }: { activeId?: string | undefined; onNavigate?: () => void }) {
  const { t } = useT()
  const { connection, clearConnection, openConnection, suffix } = useThreadFilter()
  const connections = useQuery(api.mcp.listMcpConnections, {}) as Connection[] | undefined
  // Groups: connections that talked, or that can still talk; newest activity first.
  const groups = (connections ?? [])
    .filter((c) => c.lastActivityAt !== null || c.status === "active")
    .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt))
  const focused = connection ? (connections ?? []).find((c) => c.id === connection) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 gap-3 px-3 pt-4 pb-2">
        <h1 className="px-1 text-sm font-semibold">{t("ai.title")}</h1>
        <NewThreadButton onCreated={onNavigate} className="w-full justify-start" />
        <div className="flex gap-2">
          <CopyMcpLinkButton className="flex-1" />
          <McpConnectionsSheetButton />
        </div>
        {focused && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <McpClientPill clientName={focused.clientName} />
            <span className="min-w-0 flex-1 truncate">{focused.name ?? ""}</span>
            <button type="button" onClick={clearConnection} aria-label={t("common.cancel")} className="rounded p-0.5 hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </p>
        )}
      </div>
      <nav aria-label={t("ai.threads")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {connection ? (
          focused ? (
            <ConnectionSection conn={focused} limit={PAGE} activeId={activeId} suffix={suffix} onNavigate={onNavigate} />
          ) : (
            <Skeletons />
          )
        ) : (
          <>
            <MineSection activeId={activeId} suffix={suffix} onNavigate={onNavigate} />
            {groups.map((c) => (
              <ConnectionSection key={c.id} conn={c} limit={5} activeId={activeId} suffix={suffix} onNavigate={onNavigate} onOpen={() => openConnection(c.id)} />
            ))}
          </>
        )}
      </nav>
    </div>
  )
}
