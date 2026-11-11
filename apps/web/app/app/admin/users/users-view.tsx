"use client"
import { PROFILE_ROLE_ID, SystemPermissions as P } from "@digimuza/system-core/modules"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Lock, Plus, Shield, UserPlus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { RoleSelect } from "@/components/app/role-select"
import { StatusBadge, TONE } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Badge, badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { diff, permissionsOf, toggle } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { PermissionDiff, SubrolePicker, useOverview } from "./role-shared"
import { RoleSheet } from "./role-sheet"
import { SubrolesTab } from "./subroles-tab"

type User = FunctionReturnType<typeof api.system.listUsers>["items"][number]
type Role = FunctionReturnType<typeof api.system.listRoles>["items"][number]

export function UsersView() {
  const { t } = useT()
  const canRoles = useCan(P.rolesRead)
  // One role editor for the whole page: opened from the roles list and from role badges on users.
  const [roleId, setRoleId] = useState<string | null>(null)
  return (
    <>
      <PageHeader title={t("users.title")} lead={t("users.lead")} />
      <Tabs defaultValue="users" className="gap-4">
        <TabsList>
          <TabsTrigger value="users">{t("users.tab.users")}</TabsTrigger>
          {canRoles && <TabsTrigger value="roles">{t("users.tab.roles")}</TabsTrigger>}
          {canRoles && <TabsTrigger value="subroles">{t("users.tab.subroles")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="users">
          <UsersTab onOpenRole={setRoleId} />
        </TabsContent>
        {canRoles && (
          <TabsContent value="roles">
            <RolesTab onOpenRole={setRoleId} />
          </TabsContent>
        )}
        {canRoles && (
          <TabsContent value="subroles">
            <SubrolesTab />
          </TabsContent>
        )}
      </Tabs>
      {canRoles && <RoleSheet roleId={roleId} onClose={() => setRoleId(null)} onOpenRole={setRoleId} />}
    </>
  )
}

function UsersTab({ onOpenRole }: { onOpenRole: (id: string) => void }) {
  const { t, locale } = useT()
  const users = useQuery(api.system.listUsers, { limit: 100 })
  const canRoles = useCan(P.rolesRead)
  const overview = useOverview()
  const roles = useQuery(api.system.listRoles, canRoles ? { limit: 100 } : "skip")
  const canAssign = useCan(P.assignmentCreate)
  const [assigning, setAssigning] = useState<User | null>(null)
  const roleNames = new Map((roles?.items ?? []).map((r) => [r.key, r.name]))

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "email",
      header: t("users.user"),
      cell: ({ row }) => (
        <div className="grid min-w-0 leading-tight">
          <span className="font-medium">{row.original.displayName ?? row.original.email}</span>
          {row.original.displayName && <span className="text-xs text-muted-foreground">{row.original.email}</span>}
        </div>
      ),
    },
    ...(canRoles
      ? [
          {
            id: "roles",
            header: t("users.roles"),
            cell: ({ row }) => {
              if (!overview?.userRoles || !roles) return <Skeleton className="h-4 w-20" />
              const ids = overview.userRoles[row.original.id] ?? []
              if (ids.length === 0) return <span className="text-xs text-muted-foreground">{t("users.noRoles")}</span>
              return (
                <div className="flex max-w-[24rem] flex-wrap gap-1">
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      title={t("users.openRole")}
                      className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer hover:bg-muted")}
                      onClick={() => onOpenRole(id)}
                    >
                      {roleNames.get(id) ?? id}
                    </button>
                  ))}
                </div>
              )
            },
          } satisfies ColumnDef<User>,
        ]
      : []),
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{t(`users.status.${row.original.status}` as MessageKey)}</StatusBadge> },
    { accessorKey: "createdAt", header: t("common.created"), meta: { className: "hidden md:table-cell" }, cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt, locale)}</span> },
    {
      id: "actions",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) =>
        canAssign ? (
          <Button size="sm" variant="ghost" onClick={() => setAssigning(row.original)}>
            <UserPlus />
            <span className="sr-only sm:not-sr-only">{t("users.assign")}</span>
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      {users && users.items.length === 0 ? (
        <EmptyState icon={<UserPlus />} title={t("users.empty")} />
      ) : (
        <DataTable label={t("users.tab.users")} rows={users?.items} columns={columns} getRowId={(u) => u.id} />
      )}
      <AssignDialog user={assigning} onClose={() => setAssigning(null)} />
    </>
  )
}

function RolesTab({ onOpenRole }: { onOpenRole: (id: string) => void }) {
  const { t } = useT()
  const roles = useQuery(api.system.listRoles, { limit: 100 })
  const overview = useOverview()
  const [creating, setCreating] = useState(false)

  const columns: ColumnDef<Role>[] = [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <button type="button" className="inline-flex items-center gap-1.5 text-left font-medium hover:underline" onClick={() => onOpenRole(row.original.key)}>
          {row.original.protected ? <Lock className="size-3.5 shrink-0 text-muted-foreground" /> : <Shield className="size-3.5 shrink-0 text-muted-foreground" />}
          {row.original.name}
        </button>
      ),
    },
    {
      accessorKey: "description",
      header: t("common.description"),
      meta: { className: "hidden max-w-[32rem] md:table-cell" },
      cell: ({ row }) => <span className="block truncate text-muted-foreground">{row.original.description}</span>,
    },
    {
      id: "tags",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {row.original.protected && <Badge variant="secondary">{t("roles.protected")}</Badge>}
          {overview?.roles[row.original.key]?.held && <Badge variant="outline">{t("roles.held")}</Badge>}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Can permission={P.rolesCreate}>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t("roles.new")}
          </Button>
        </Can>
      </div>
      {roles && roles.items.length === 0 ? (
        <EmptyState icon={<Shield />} title={t("roles.empty")} />
      ) : (
        <DataTable label={t("users.tab.roles")} rows={roles?.items} columns={columns} getRowId={(r) => r.key} />
      )}
      <NewRoleDialog open={creating} onOpenChange={setCreating} onCreated={onOpenRole} />
    </>
  )
}

function NewRoleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { t } = useT()
  const subroles = useQuery(api.system.listSubroles, open ? {} : "skip")
  const overview = useOverview()
  const createRole = useMutation(api.system.createRole)
  const { run, busy } = useAction()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const granted = overview ? diff([], permissionsOf(picked, overview.subrolePermissions)).added : []

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => createRole({ name: name.trim(), description, subroleIds: picked }), { success: t("roles.created") })
    if (res) {
      setName("")
      setDescription("")
      setPicked([])
      onOpenChange(false)
      onCreated(res.roleId)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("roles.newTitle")}</DialogTitle>
            <DialogDescription>{t("roles.subrolesHelp")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="role-name">{t("common.name")}</FieldLabel>
              <Input id="role-name" required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="role-description">{t("common.description")}</FieldLabel>
              <Textarea id="role-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">{t("roles.subroles")}</FieldLegend>
              <FieldDescription className="sr-only">{t("roles.subrolesHelp")}</FieldDescription>
              {!subroles || !overview ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <SubrolePicker subroles={subroles} subrolePermissions={overview.subrolePermissions} entitlements={overview.entitlements} picked={picked} onToggle={(id, on) => setPicked(toggle(picked, id, on))} />
              )}
            </FieldSet>
          </FieldGroup>
          {picked.length > 0 && <PermissionDiff added={granted} removed={[]} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || picked.length === 0 || !name.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useT()
  const roles = useQuery(api.system.listRoles, user ? { limit: 100 } : "skip")
  const assign = useMutation(api.system.assignRoles)
  const { run, busy } = useAction()
  const [roleId, setRoleId] = useState("")
  // Profile is held implicitly by every active user; Admin is protected but grantable.
  const options = (roles?.items ?? []).filter((r) => r.key !== PROFILE_ROLE_ID && !r.archived)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const res = await run(() => assign({ userId: user.id, roleIds: [roleId] }), { success: t("users.assigned") })
    if (res) {
      setRoleId("")
      onClose()
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("users.assignTitle")}</DialogTitle>
            <DialogDescription>{user?.displayName ?? user?.email}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="assign-role">{t("common.role")}</FieldLabel>
            <RoleSelect id="assign-role" roles={options} value={roleId} onChange={setRoleId} placeholder={t("common.role")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !roleId}>
              {t("users.assign")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
