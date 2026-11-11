"use client"
import { PROFILE_ROLE_ID, SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Archive, Copy, Lock, Shield } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { diff, permissionsOf, sameSet, toggle } from "@/lib/roles"
import { ConfirmDialog, fill, LockNote, NameDialog, PermissionBadge, PermissionDiff, SubrolePicker, useLockText, useOverview, type Overview, type Subrole } from "./role-shared"

type RoleDetail = FunctionReturnType<typeof api.system.getRole>
type RoleRow = FunctionReturnType<typeof api.system.listRoles>["items"][number]

/** Role detail and editor: contents, permission diff before save, holders, delegation, copy, archive. */
export function RoleSheet({ roleId, onClose, onOpenRole }: { roleId: string | null; onClose: () => void; onOpenRole: (id: string) => void }) {
  const { t } = useT()
  const detail = useQuery(api.system.getRole, roleId ? { roleId } : "skip")
  const overview = useOverview()
  const subroles = useQuery(api.system.listSubroles, roleId ? {} : "skip")
  const access = roleId ? overview?.roles[roleId] : undefined
  const loading = !detail || !overview || !subroles

  return (
    <Sheet open={!!roleId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            {detail?.role.protected ? <Lock className="size-4" /> : <Shield className="size-4" />}
            {detail ? detail.role.name : <Skeleton className="h-5 w-40" />}
          </SheetTitle>
          {detail?.role.description && <SheetDescription>{detail.role.description}</SheetDescription>}
          {detail && (
            <div className="flex flex-wrap gap-1.5">
              {detail.role.protected && <Badge variant="secondary">{t("roles.protected")}</Badge>}
              {access?.held && <Badge variant="outline">{t("roles.held")}</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{detail.role.key}</span>
            </div>
          )}
        </SheetHeader>
        <div className="grid gap-8 px-4 pb-8">
          {loading ? (
            <div className="grid gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detail.role.archived || !access ? (
            <p className="text-sm text-muted-foreground">{t("roles.notFound")}</p>
          ) : (
            <>
              <RoleEditForm key={formKey(detail)} detail={detail} overview={overview} subroles={subroles} />
              <Holders detail={detail} />
              <Delegation key={detail.delegates.join("|")} detail={detail} overview={overview} />
              <RoleActions detail={detail} overview={overview} onArchived={onClose} onOpenRole={onOpenRole} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Remount the form with fresh values whenever the saved role changes.
const formKey = (d: RoleDetail) => [d.role.key, d.role.name, d.role.description, ...d.subroles.map((s) => s.id).sort()].join("|")

function RoleEditForm({ detail, overview, subroles }: { detail: RoleDetail; overview: Overview; subroles: Subrole[] }) {
  const { t } = useT()
  const canUpdate = useCan(P.rolesUpdate)
  const update = useMutation(api.system.updateRole)
  const { run, busy } = useAction()
  const roleId = detail.role.key
  const lock = canUpdate ? (overview.roles[roleId]?.edit ?? null) : "no_permission"

  const activeIds = new Set(subroles.map((s) => s.key))
  const initialSubroles = detail.subroles.map((s) => s.id).filter((id) => activeIds.has(id))
  const [name, setName] = useState(detail.role.name)
  const [description, setDescription] = useState(detail.role.description)
  const [picked, setPicked] = useState<string[]>(initialSubroles)

  const before = new Set(detail.subroles.flatMap((s) => s.permissions))
  const subrolesChanged = !sameSet(initialSubroles, picked)
  const change = diff(before, permissionsOf(picked, overview.subrolePermissions))
  const nameValid = name.trim().length > 0 && name.length <= 120
  const dirty = name.trim() !== detail.role.name || description !== detail.role.description || subrolesChanged

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!nameValid || !dirty) return
    await run(
      () =>
        update({
          roleId,
          ...(name.trim() !== detail.role.name ? { name: name.trim() } : {}),
          ...(description !== detail.role.description ? { description } : {}),
          ...(subrolesChanged ? { subroleIds: picked } : {}),
        }),
      { success: t("roles.updated") },
    )
  }

  if (lock) {
    return (
      <section className="grid gap-4">
        {lock !== "no_permission" && <LockNote reason={lock} />}
        <h3 className="text-sm font-medium">{t("roles.permissions")}</h3>
        {detail.subroles.length === 0 && <p className="text-sm text-muted-foreground">{t("common.none")}</p>}
        {detail.subroles.map((s) => (
          <div key={s.id} className="grid gap-2">
            <div className="text-sm">
              {s.name} <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.permissions.map((p) => (
                <PermissionBadge key={p} id={p} />
              ))}
            </div>
          </div>
        ))}
      </section>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <FieldGroup>
        <Field data-invalid={!nameValid || undefined}>
          <FieldLabel htmlFor="role-edit-name">{t("common.name")}</FieldLabel>
          <Input id="role-edit-name" required maxLength={120} aria-invalid={!nameValid} value={name} onChange={(e) => setName(e.target.value)} />
          {!nameValid && <FieldDescription className="text-destructive">{t("roles.nameInvalid")}</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="role-edit-description">{t("common.description")}</FieldLabel>
          <Textarea id="role-edit-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t("roles.subroles")}</FieldLegend>
          <FieldDescription>{t("roles.subrolesHelp")}</FieldDescription>
          <SubrolePicker subroles={subroles} subrolePermissions={overview.subrolePermissions} entitlements={overview.entitlements} picked={picked} onToggle={(id, on) => setPicked(toggle(picked, id, on))} />
        </FieldSet>
      </FieldGroup>
      {subrolesChanged && (
        <PermissionDiff added={change.added} removed={change.removed} footer={fill(t("roles.affects"), { users: detail.grantees.users, keys: detail.grantees.apiKeys })} />
      )}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-popover px-4 py-3">
        {!dirty && <span className="mr-auto text-xs text-muted-foreground">{t("roles.noChanges")}</span>}
        <Button type="submit" disabled={busy || !dirty || !nameValid}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}

function Holders({ detail }: { detail: RoleDetail }) {
  const { t } = useT()
  const canRevoke = useCan(P.assignmentDelete)
  const canUsers = useCan(P.usersRead)
  const users = useQuery(api.system.listUsers, canUsers && detail.grantees.userIds?.length ? { limit: 100 } : "skip")
  const revoke = useMutation(api.system.revokeRole)
  const { run, busy } = useAction()
  const byId = new Map((users?.items ?? []).map((u) => [u.id, u]))
  const ids = detail.grantees.userIds ?? []

  return (
    <section className="grid gap-3">
      <Separator />
      <div>
        <h3 className="text-sm font-medium">{t("roles.grantees")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("roles.users")}: {detail.grantees.users} · {t("roles.apiKeys")}: {detail.grantees.apiKeys}
        </p>
      </div>
      {ids.length > 0 && (
        <ul className="grid gap-1">
          {ids.map((uid) => {
            const u = byId.get(uid)
            return (
              <li key={uid} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{u ? (u.displayName ?? u.email) : <span className="font-mono text-xs">{uid}</span>}</span>
                {canRevoke && detail.role.key !== PROFILE_ROLE_ID && (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(() => revoke({ userId: uid, roleId: detail.role.key }), { success: t("roles.revoked") })}>
                    {t("roles.revoke")}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const ANY = "*"

function Delegation({ detail, overview }: { detail: RoleDetail; overview: Overview }) {
  const { t } = useT()
  const lockText = useLockText()
  const canDelegate = useCan(P.delegationUpdate)
  const roles = useQuery(api.system.listRoles, canDelegate ? { limit: 100 } : "skip")
  const save = useMutation(api.system.setDelegationScope)
  const { run, busy } = useAction()
  const [picked, setPicked] = useState<string[]>(detail.delegates)
  if (!canDelegate) return null

  const roleId = detail.role.key
  const lock = overview.roles[roleId]?.delegation ?? (!overview.isSuper && detail.delegates.includes(ANY) ? "wildcard_scope_requires_super" : null)
  const options = (roles?.items ?? []).filter((r: RoleRow) => r.key !== PROFILE_ROLE_ID && !r.archived)
  const names = new Map(options.map((r) => [r.key, r.name]))
  const grantLock = (id: string) => (overview.isSuper ? null : id === ANY ? "wildcard_scope_requires_super" : (overview.roles[id]?.grant ?? "unknown_role"))
  const blocked = picked.map((id) => [id, grantLock(id)] as const).find(([, l]) => l)
  const dirty = !sameSet(picked, detail.delegates)

  return (
    <section className="grid gap-3">
      <Separator />
      <div>
        <h3 className="text-sm font-medium">{t("roles.delegation")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("roles.delegationLead")}</p>
      </div>
      {lock ? (
        <>
          <LockNote reason={lock} />
          {detail.delegates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("roles.delegationNone")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.delegates.map((id) => (
                <Badge key={id} variant="outline">
                  {id === ANY ? t("roles.delegationAny") : (names.get(id) ?? id)}
                </Badge>
              ))}
            </div>
          )}
        </>
      ) : !roles ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="grid gap-2">
            {[{ key: ANY, name: t("roles.delegationAny") }, ...options].map((r) => {
              const l = grantLock(r.key)
              const checked = picked.includes(r.key)
              return (
                <Label key={r.key} className="flex items-start gap-2 font-normal">
                  <Checkbox className="mt-0.5" checked={checked} disabled={!!l && !checked} onCheckedChange={(v) => setPicked(toggle(picked, r.key, v === true))} />
                  <span className="grid min-w-0">
                    <span>{r.name}</span>
                    {l && <span className="text-xs text-muted-foreground">{lockText(l)}</span>}
                  </span>
                </Label>
              )
            })}
          </div>
          {blocked && <LockNote reason={blocked[1]!} />}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !dirty || !!blocked}
              onClick={() => void run(() => save({ roleId, grantableRoleIds: picked }), { success: t("roles.delegationSaved") })}
            >
              {t("common.save")}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function RoleActions({ detail, overview, onArchived, onOpenRole }: { detail: RoleDetail; overview: Overview; onArchived: () => void; onOpenRole: (id: string) => void }) {
  const { t } = useT()
  const lockText = useLockText()
  const canCopy = useCan(P.rolesCreate)
  const canArchive = useCan(P.rolesArchive)
  const copy = useMutation(api.system.copyRole)
  const archive = useMutation(api.system.archiveRole)
  const { run, busy } = useAction()
  const [copying, setCopying] = useState(false)
  const [archiving, setArchiving] = useState(false)
  if (!canCopy && !canArchive) return null

  const roleId = detail.role.key
  const ent = overview.entitlements ? new Set(overview.entitlements) : null
  // copyRole creates a role with the same subroles: core refuses if they exceed the actor's authority.
  const copyLock = roleId === PROFILE_ROLE_ID ? "implicit_role" : ent && detail.subroles.some((s) => s.permissions.some((p) => !ent.has(p))) ? "exceeds_authority" : null
  const archiveLock = overview.roles[roleId]?.archive ?? null

  return (
    <section className="grid gap-3">
      <Separator />
      <div className="flex flex-wrap gap-2">
        {canCopy && (
          <Button type="button" variant="outline" disabled={!!copyLock} onClick={() => setCopying(true)}>
            <Copy />
            {t("roles.copy")}
          </Button>
        )}
        {canArchive && (
          <Button type="button" variant="destructive" disabled={!!archiveLock} onClick={() => setArchiving(true)}>
            <Archive />
            {t("roles.archive")}
          </Button>
        )}
      </div>
      {canCopy && copyLock && <p className="text-xs text-muted-foreground">{`${t("roles.copy")}: ${lockText(copyLock)}`}</p>}
      {canArchive && archiveLock && <p className="text-xs text-muted-foreground">{`${t("roles.archive")}: ${lockText(archiveLock)}`}</p>}

      <NameDialog
        open={copying}
        onOpenChange={setCopying}
        title={t("roles.copyTitle")}
        lead={t("roles.copyLead")}
        initialName={`${detail.role.name} ${t("roles.copySuffix")}`}
        initialDescription={detail.role.description}
        submitLabel={t("common.create")}
        busy={busy}
        onSubmit={async ({ name, description }) => {
          const res = await run(() => copy({ roleId, name, description }), { success: t("roles.copied") })
          if (res) onOpenRole(res.roleId)
          return !!res
        }}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("roles.archiveTitle")}
        confirmLabel={t("roles.archive")}
        busy={busy}
        onConfirm={async () => {
          // archiveRole returns nothing: map success to true (run returns undefined on failure).
          const ok = await run(
            async () => {
              await archive({ roleId })
              return true
            },
            { success: t("roles.archived") },
          )
          if (ok) {
            setArchiving(false)
            onArchived()
          }
        }}
      >
        <p>{t("roles.archiveLead")}</p>
        <p className="font-medium text-foreground">{fill(t("roles.archiveImpact"), { users: detail.grantees.users, keys: detail.grantees.apiKeys })}</p>
      </ConfirmDialog>
    </section>
  )
}
