"use client"
import { PROFILE_ROLE_ID, SystemPermissions as P } from "@digimuza/system-core/modules"
import { Can, useCan } from "@digimuza/system-core/react"
import { useAction as useConvexAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Mail, MailPlus, RotateCw, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { RoleSelect } from "@/components/app/role-select"
import { StatusBadge, TONE } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

type Invite = FunctionReturnType<typeof api.system.listInvites>["items"][number]
const DAY = 24 * 60 * 60 * 1000

export function InvitesView() {
  const { t, locale } = useT()
  const invites = useQuery(api.system.listInvites, { limit: 100 })
  const resend = useConvexAction(api.system.resendInvite)
  const revoke = useMutation(api.system.revokeInvite)
  const canResend = useCan(P.invitesResend)
  const canRevoke = useCan(P.invitesRevoke)
  const { run, busy } = useAction()
  const [inviting, setInviting] = useState(false)

  const columns: ColumnDef<Invite>[] = [
    { accessorKey: "email", header: t("common.email"), cell: ({ row }) => <span className="font-medium">{row.original.email}</span> },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{t(`inv.status.${row.original.status}` as MessageKey)}</StatusBadge>,
    },
    {
      accessorKey: "deliveryStatus",
      header: t("inv.delivery"),
      cell: ({ row }) => (
        <span className={row.original.deliveryStatus === "failed" ? "text-destructive" : "text-muted-foreground"}>
          {t(`inv.delivery.${row.original.deliveryStatus}` as MessageKey)} · {row.original.deliveryAttempts}×
        </span>
      ),
    },
    { accessorKey: "expiresAt", header: t("common.expires"), cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.expiresAt, locale)}</span> },
    {
      id: "actions",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) =>
        row.original.status === "pending" ? (
          <div className="flex justify-end gap-1">
            {canResend && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => resend({ inviteId: row.original.id }), { success: t("inv.sent") })}>
                <RotateCw />
                {t("inv.resend")}
              </Button>
            )}
            {canRevoke && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t("inv.revoke")} disabled={busy} onClick={() => void run(() => revoke({ inviteId: row.original.id }), { success: t("inv.revoked") })}>
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("inv.revoke")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : null,
    },
  ]

  const inviteButton = (
    <Can permission={P.invitesCreate}>
      <Button onClick={() => setInviting(true)}>
        <MailPlus />
        {t("inv.new")}
      </Button>
    </Can>
  )

  return (
    <>
      <PageHeader title={t("inv.title")} lead={t("inv.lead")} actions={inviteButton} />
      {invites?.items.length === 0 ? (
        <EmptyState icon={<Mail />} title={t("inv.empty.title")} body={t("inv.empty.body")} action={inviteButton} />
      ) : (
        <DataTable label={t("inv.title")} rows={invites?.items} columns={columns} getRowId={(i) => i.id} />
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  )
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useT()
  const canRoles = useCan(P.rolesRead)
  const roles = useQuery(api.system.listRoles, canRoles && open ? { limit: 100 } : "skip")
  const create = useConvexAction(api.system.createInvite)
  const { run, busy } = useAction()
  const [email, setEmail] = useState("")
  const [roleId, setRoleId] = useState("")
  const options = (roles?.items ?? []).filter((r) => !r.archived && r.key !== PROFILE_ROLE_ID)

  async function submit(e: FormEvent) {
    e.preventDefault()
    // The inviter must be allowed to grant the role; checked again on acceptance.
    const res = await run(() => create({ email, roleIds: [roleId], expiresInMs: 7 * DAY }))
    if (!res) return
    if (res.deliveryStatus === "sent") toast.success(t("inv.sent"))
    else toast.warning(t("inv.notSent"))
    setEmail("")
    setRoleId("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("inv.newTitle")}</DialogTitle>
            <DialogDescription>{t("inv.lead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">{t("common.email")}</FieldLabel>
              <Input id="invite-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">{t("common.role")}</FieldLabel>
              <RoleSelect id="invite-role" roles={options} value={roleId} onChange={setRoleId} placeholder={t("common.role")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !roleId}>
              {t("inv.new")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
