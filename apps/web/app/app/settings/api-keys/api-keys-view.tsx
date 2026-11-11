"use client"
import { PROFILE_ROLE_ID, SystemPermissions as P } from "@digimuza/system-core/modules"
import { Can, useCan } from "@digimuza/system-core/react"
import { useAction as useConvexAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Copy, KeyRound, Plus, RotateCw, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { StatusBadge, TONE } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

type ApiKey = FunctionReturnType<typeof api.system.listMyApiKeys>[number]

/**
 * Agent API keys. A key acts with the intersection of its roles and the
 * owner's current permissions, never as Super. The secret is shown once.
 */
export function ApiKeysView() {
  const { t, locale } = useT()
  const keys = useQuery(api.system.listMyApiKeys, {})
  const rotate = useConvexAction(api.system.rotateApiKey)
  const revoke = useMutation(api.system.revokeApiKey)
  const canRotate = useCan(P.ownKeysUpdate)
  const canRevoke = useCan(P.ownKeysRevoke)
  const { run, busy } = useAction()
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  const columns: ColumnDef<ApiKey>[] = [
    { accessorKey: "name", header: t("common.name"), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: "prefix", header: t("keys.prefix"), cell: ({ row }) => <span className="font-mono text-[13px] text-muted-foreground">{row.original.prefix}</span> },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{t(`keys.status.${row.original.status}` as MessageKey)}</StatusBadge> },
    { accessorKey: "createdAt", header: t("common.created"), cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt, locale)}</span> },
    {
      accessorKey: "expiresAt",
      header: t("common.expires"),
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.expiresAt ? formatDate(row.original.expiresAt, locale) : t("common.none")}</span>,
    },
    {
      id: "actions",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <div className="flex justify-end gap-1">
            {canRotate && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  const res = await run(() => rotate({ apiKeyId: row.original.id }))
                  if (res) setSecret(res.secret)
                }}
              >
                <RotateCw />
                {t("keys.rotate")}
              </Button>
            )}
            {canRevoke && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t("keys.revoke")} disabled={busy} onClick={() => void run(() => revoke({ apiKeyId: row.original.id }), { success: t("keys.revoked") })}>
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("keys.revoke")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : null,
    },
  ]

  const newButton = (
    <Can permission={P.ownKeysCreate}>
      <Button onClick={() => setCreating(true)}>
        <Plus />
        {t("keys.new")}
      </Button>
    </Can>
  )

  return (
    <>
      <PageHeader title={t("keys.title")} lead={t("keys.lead")} actions={newButton} />
      {keys?.length === 0 ? (
        <EmptyState icon={<KeyRound />} title={t("keys.empty.title")} body={t("keys.empty.body")} action={newButton} />
      ) : (
        <DataTable label={t("keys.title")} rows={keys} columns={columns} getRowId={(k) => k.id} />
      )}
      <NewKeyDialog open={creating} onOpenChange={setCreating} onSecret={setSecret} />
      <SecretDialog secret={secret} onDone={() => setSecret(null)} />
    </>
  )
}

function NewKeyDialog({ open, onOpenChange, onSecret }: { open: boolean; onOpenChange: (v: boolean) => void; onSecret: (s: string) => void }) {
  const { t } = useT()
  const canRoles = useCan(P.rolesRead)
  const roles = useQuery(api.system.listRoles, canRoles && open ? { limit: 100 } : "skip")
  const create = useConvexAction(api.system.createApiKey)
  const { run, busy } = useAction()
  const [name, setName] = useState("")
  const [roleIds, setRoleIds] = useState<string[]>([])
  const grantable = (roles?.items ?? []).filter((r) => !r.protected && !r.archived && r.key !== PROFILE_ROLE_ID)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => create({ name, roleIds }))
    if (!res) return
    setName("")
    setRoleIds([])
    onOpenChange(false)
    onSecret(res.secret)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("keys.newTitle")}</DialogTitle>
            <DialogDescription>{t("keys.lead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="key-name">{t("common.name")}</FieldLabel>
              <Input id="key-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">{t("common.roles")}</FieldLegend>
              <FieldDescription>{t("keys.rolesHelp")}</FieldDescription>
              <div className="grid gap-2">
                {grantable.map((r) => (
                  <Label key={r.key} className="flex items-center gap-2 font-normal">
                    <Checkbox checked={roleIds.includes(r.key)} onCheckedChange={(v) => setRoleIds(v ? [...roleIds, r.key] : roleIds.filter((x) => x !== r.key))} />
                    {r.name}
                  </Label>
                ))}
              </div>
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The secret, exactly once. Closing requires an explicit "copied". */
function SecretDialog({ secret, onDone }: { secret: string | null; onDone: () => void }) {
  const { t } = useT()
  return (
    <Dialog open={!!secret}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("keys.secretTitle")}</DialogTitle>
          <DialogDescription>{t("keys.secretBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted p-3">
          <code className="flex-1 break-all font-mono text-[13px]">{secret}</code>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("common.copy")}
            onClick={async () => {
              if (!secret) return
              await navigator.clipboard.writeText(secret)
              toast.success(t("common.copied"))
            }}
          >
            <Copy />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onDone}>{t("keys.secretDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
