"use client"
import type { McpConnectionView } from "@digimuza/system-core/mcp"
import { useMutation, useQuery } from "convex/react"
import { MessagesSquare, Plug, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState, type ReactNode } from "react"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/empty-state"
import { StatusBadge, TONE } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { formatDate, formatTime } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { Locale, MessageKey } from "@/lib/i18n/messages"
import { ConnectMcpButton } from "./connect"
import { useMcpAccess } from "./mcp-context"

/** Threads of one connection in the AI assistant (the thread list reads `?connection=`). */
export const connectionThreadsHref = (id: string) => `/app/ai?connection=${id}`

function when(ms: number | null, locale: Locale, never: string) {
  if (!ms) return never
  return new Date(ms).toDateString() === new Date().toDateString() ? formatTime(ms, locale) : formatDate(ms, locale)
}

function RevokeButton({ connection, onRevoke }: { connection: McpConnectionView; onRevoke: (c: McpConnectionView) => void }) {
  const { t } = useT()
  if (connection.status !== "active") return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t("mcp.revoke")} onClick={() => onRevoke(connection)}>
          <Trash2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("mcp.revoke")}</TooltipContent>
    </Tooltip>
  )
}

/** Full table (settings page). `scope: "all"` adds the owner column (mcp:connection:manage). */
export function McpConnectionsTable({ scope, emptyAction }: { scope: "mine" | "all"; emptyAction?: ReactNode }) {
  const { t, locale } = useT()
  const rows = useQuery(api.mcp.listMcpConnections, { scope })
  const [revoking, setRevoking] = useState<McpConnectionView | null>(null)

  const columns: ColumnDef<McpConnectionView>[] = [
    {
      accessorKey: "clientName",
      header: t("mcp.col.client"),
      cell: ({ row }) => (
        <div className="grid gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            <Plug className="size-3.5 text-muted-foreground" aria-hidden />
            {row.original.clientName}
          </span>
          {row.original.name && <span className="text-xs text-muted-foreground">{row.original.name}</span>}
        </div>
      ),
    },
    ...(scope === "all"
      ? [{ accessorKey: "ownerEmail", header: t("mcp.col.owner"), cell: ({ row }) => <span className="text-muted-foreground">{row.original.ownerEmail ?? "—"}</span> } satisfies ColumnDef<McpConnectionView>]
      : []),
    {
      id: "roles",
      header: t("common.roles"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.roles.map((r) => (
            <Badge key={r.id} variant="outline">
              {r.name}
            </Badge>
          ))}
        </div>
      ),
    },
    { accessorKey: "createdAt", header: t("common.created"), cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt, locale)}</span> },
    { accessorKey: "lastUsedAt", header: t("mcp.col.lastUsed"), cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{when(row.original.lastUsedAt, locale, t("mcp.never"))}</span> },
    { accessorKey: "lastActivityAt", header: t("mcp.col.activity"), cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{when(row.original.lastActivityAt, locale, t("mcp.never"))}</span> },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{t(`mcp.status.${row.original.status}` as MessageKey)}</StatusBadge> },
    {
      id: "actions",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {scope === "mine" && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={connectionThreadsHref(row.original.id)}>
                <MessagesSquare />
                {t("mcp.threads")}
              </Link>
            </Button>
          )}
          <RevokeButton connection={row.original} onRevoke={setRevoking} />
        </div>
      ),
    },
  ]

  if (rows?.length === 0) return <EmptyState icon={<Plug />} title={t("mcp.empty.title")} body={t("mcp.empty.body")} action={emptyAction} />
  return (
    <>
      <DataTable label={t("mcp.connections")} rows={rows} columns={columns} getRowId={(c) => c.id} />
      <RevokeDialog connection={revoking} onClose={() => setRevoking(null)} />
    </>
  )
}

/** Compact list of the person's connections (the AI assistant's sheet). */
export function McpConnectionsList({ onNavigate }: { onNavigate?: () => void }) {
  const { t, locale } = useT()
  const rows = useQuery(api.mcp.listMcpConnections, {})
  const [revoking, setRevoking] = useState<McpConnectionView | null>(null)
  if (rows === undefined)
    return (
      <div className="grid gap-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (rows.length === 0) return <EmptyState icon={<Plug />} title={t("mcp.empty.title")} body={t("mcp.empty.body")} />
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((c) => (
          <li key={c.id} className="grid gap-2 rounded-lg border bg-card p-3 text-sm">
            <div className="flex items-start gap-2">
              <Plug aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="truncate font-medium">{c.clientName}</p>
                {c.name && <p className="truncate text-xs text-muted-foreground">{c.name}</p>}
              </div>
              <StatusBadge tone={TONE[c.status] ?? "neutral"}>{t(`mcp.status.${c.status}` as MessageKey)}</StatusBadge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t("mcp.col.lastUsed")}</dt>
              <dd className="tabular-nums">{when(c.lastUsedAt, locale, t("mcp.never"))}</dd>
              <dt className="text-muted-foreground">{t("common.roles")}</dt>
              <dd className="flex flex-wrap gap-1">
                {c.roles.map((r) => (
                  <Badge key={r.id} variant="outline" className="text-[11px]">
                    {r.name}
                  </Badge>
                ))}
              </dd>
            </dl>
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={connectionThreadsHref(c.id)} onClick={onNavigate}>
                  <MessagesSquare />
                  {t("mcp.threads")}
                </Link>
              </Button>
              <RevokeButton connection={c} onRevoke={setRevoking} />
            </div>
          </li>
        ))}
      </ul>
      <RevokeDialog connection={revoking} onClose={() => setRevoking(null)} />
    </>
  )
}

/** "Prijungimai" next to "new conversation": a sheet with the connections and a new link button. */
export function McpConnectionsSheetButton({ className }: { className?: string }) {
  const { t } = useT()
  const { canConnect } = useMcpAccess()
  const [open, setOpen] = useState(false)
  if (!canConnect) return null
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t("ai.mcp.connections")} className={className}>
              <Plug />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("ai.mcp.connections")}</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("ai.mcp.connections")}</SheetTitle>
          <SheetDescription>{t("ai.mcp.connectionsLead")}</SheetDescription>
          <ConnectMcpButton className="mt-2 w-fit">
            <Plug />
            {t("ai.mcp.newLink")}
          </ConnectMcpButton>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <McpConnectionsList onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function RevokeDialog({ connection, onClose }: { connection: McpConnectionView | null; onClose: () => void }) {
  const { t } = useT()
  const revoke = useMutation(api.mcp.revokeMcpConnection)
  const { run, busy } = useAction()
  return (
    <Dialog open={!!connection} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mcp.revoke.title").replace("{client}", connection?.clientName ?? "")}</DialogTitle>
          <DialogDescription>{t("mcp.revoke.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!connection) return
              const ok = await run(() => revoke({ connectionId: connection.id }), { success: t("mcp.revoked") })
              if (ok !== undefined) onClose()
            }}
          >
            {t("mcp.revoke")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
