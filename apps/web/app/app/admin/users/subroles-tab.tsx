"use client"
import { SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Archive, ChevronRight, Copy, Layers, Lock, Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { byModule, diff, parseBlocker, sameSet, toggle } from "@/lib/roles"
import { ConfirmDialog, fill, LockNote, NameDialog, PermissionBadge, PermissionDiff, useLockText, useOverview, usePermissionCatalog, type Overview, type Permission, type Subrole } from "./role-shared"

const NEW = "new"

/** Subroles per module: create from permissions, edit with impact preview, copy, archive. */
export function SubrolesTab() {
  const { t } = useT()
  const subroles = useQuery(api.system.listSubroles, {})
  const overview = useOverview()
  const canCreate = useCan(P.subrolesCreate)
  const canCatalog = useCan(P.permissionsRead)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      {canCreate && canCatalog && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setOpen(NEW)}>
            <Plus />
            {t("subroles.new")}
          </Button>
        </div>
      )}
      {!subroles || !overview ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : subroles.length === 0 ? (
        <EmptyState icon={<Layers />} title={t("subroles.empty")} />
      ) : (
        <div className="grid gap-4">
          {byModule(subroles).map(([moduleId, list]) => (
            <section key={moduleId} className="overflow-hidden rounded-xl border bg-card" aria-label={moduleId}>
              <h3 className="border-b bg-muted/50 px-4 py-2 font-mono text-xs text-muted-foreground">{moduleId}</h3>
              <ul className="divide-y">
                {list.map((s) => (
                  <li key={s.key}>
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(s.key)}>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          <Badge variant={s.origin === "template" ? "secondary" : "outline"}>{t(s.origin === "template" ? "subroles.origin.template" : "subroles.origin.custom")}</Badge>
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{s.key}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{fill(t("subroles.count"), { count: overview.subrolePermissions[s.key]?.length ?? 0 })}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <SubroleSheet id={open} subroles={subroles} overview={overview} onClose={() => setOpen(null)} onOpen={setOpen} />
    </>
  )
}

function SubroleSheet({ id, subroles, overview, onClose, onOpen }: { id: string | null; subroles: Subrole[] | undefined; overview: Overview | undefined; onClose: () => void; onOpen: (id: string) => void }) {
  const { t } = useT()
  const catalog = usePermissionCatalog()
  const subrole = id && id !== NEW ? subroles?.find((s) => s.key === id) : undefined
  const loading = !overview || !catalog || !subroles

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Layers className="size-4" />
            {id === NEW ? t("subroles.newTitle") : (subrole?.name ?? <Skeleton className="h-5 w-40" />)}
          </SheetTitle>
          {id === NEW && <SheetDescription>{t("subroles.newLead")}</SheetDescription>}
          {subrole && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={subrole.origin === "template" ? "secondary" : "outline"}>{t(subrole.origin === "template" ? "subroles.origin.template" : "subroles.origin.custom")}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{subrole.key}</span>
            </div>
          )}
        </SheetHeader>
        <div className="grid gap-8 px-4 pb-8">
          {loading ? (
            <div className="grid gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : id === NEW ? (
            <NewSubroleForm overview={overview} catalog={catalog} onCreated={onOpen} />
          ) : !subrole ? (
            <p className="text-sm text-muted-foreground">{t("roles.notFound")}</p>
          ) : (
            <EditSubrole
              key={[subrole.key, subrole.name, subrole.description, ...(overview.subrolePermissions[subrole.key] ?? [])].join("|")}
              subrole={subrole}
              overview={overview}
              catalog={catalog}
              onClose={onClose}
              onOpen={onOpen}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Checkboxes for one module's permissions; ones beyond the actor's entitlements can't be added. */
function PermissionPicker({ permissions, entitlements, picked, onToggle, disabled }: { permissions: Permission[]; entitlements: string[] | null; picked: string[]; onToggle: (id: string, on: boolean) => void; disabled?: boolean }) {
  const { t } = useT()
  const ent = entitlements ? new Set(entitlements) : null
  return (
    <div className="grid gap-2">
      {permissions.map((p) => {
        const checked = picked.includes(p.id)
        const exceeds = !!ent && !ent.has(p.id)
        return (
          <Label key={p.id} className="flex items-start gap-2 rounded-md border p-2 font-normal has-[[data-state=checked]]:bg-muted/50">
            <Checkbox className="mt-0.5" checked={checked} disabled={disabled || (exceeds && !checked)} onCheckedChange={(v) => onToggle(p.id, v === true)} />
            <span className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{p.name}</span>
                {exceeds && <span className="text-xs text-destructive">{t("roles.exceeds")}</span>}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">{p.id}</span>
              {p.description && <span className="text-xs text-muted-foreground">{p.description}</span>}
            </span>
          </Label>
        )
      })}
    </div>
  )
}

function NewSubroleForm({ overview, catalog, onCreated }: { overview: Overview; catalog: Permission[]; onCreated: (id: string) => void }) {
  const { t } = useT()
  const create = useMutation(api.system.createSubrole)
  const { run, busy } = useAction()
  const modules = byModule(catalog)
  const [moduleId, setModuleId] = useState(modules[0]?.[0] ?? "")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const permissions = modules.find(([m]) => m === moduleId)?.[1] ?? []
  const valid = name.trim().length > 0 && name.length <= 120 && picked.length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const res = await run(() => create({ moduleId, name: name.trim(), description, permissionIds: picked }), { success: t("subroles.created") })
    if (res) onCreated(res.subroleId)
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="subrole-module">{t("subroles.module")}</FieldLabel>
          <Select
            value={moduleId}
            onValueChange={(v) => {
              setModuleId(v)
              setPicked([])
            }}
          >
            <SelectTrigger id="subrole-module" className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modules.map(([m]) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="subrole-name">{t("common.name")}</FieldLabel>
          <Input id="subrole-name" required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="subrole-description">{t("common.description")}</FieldLabel>
          <Textarea id="subrole-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t("subroles.permissions")}</FieldLegend>
          <FieldDescription>{t("subroles.permissionsHelp")}</FieldDescription>
          <PermissionPicker permissions={permissions} entitlements={overview.entitlements} picked={picked} onToggle={(id, on) => setPicked(toggle(picked, id, on))} />
        </FieldSet>
      </FieldGroup>
      <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-popover px-4 py-3">
        <Button type="submit" disabled={busy || !valid}>
          {t("common.create")}
        </Button>
      </div>
    </form>
  )
}

function EditSubrole({ subrole, overview, catalog, onClose, onOpen }: { subrole: Subrole; overview: Overview; catalog: Permission[]; onClose: () => void; onOpen: (id: string) => void }) {
  const { t } = useT()
  const lockText = useLockText()
  const canUpdate = useCan(P.subrolesUpdate)
  const canCopy = useCan(P.subrolesCreate)
  const canArchive = useCan(P.subrolesArchive)
  const canCatalog = useCan(P.permissionsRead)
  const update = useMutation(api.system.updateSubrole)
  const copy = useMutation(api.system.copySubrole)
  const archive = useMutation(api.system.archiveSubrole)
  const { run, busy } = useAction()
  const subroleId = subrole.key
  const initial = overview.subrolePermissions[subroleId] ?? []

  const [name, setName] = useState(subrole.name)
  const [description, setDescription] = useState(subrole.description)
  const [picked, setPicked] = useState<string[]>(initial)
  const [copying, setCopying] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const { added: add, removed: remove } = diff(initial, picked)
  // Live: which roles and holders this change reaches, and whether core would refuse it.
  const preview = useQuery(api.system.previewSubroleChange, { subroleId, add, remove })

  // Blockers that come from the roles using the subrole (not from this particular change).
  const structural = (preview?.blockers ?? []).filter((b) => b !== "exceeds_authority")
  const roleName = (id?: string) => preview?.affectedRoles.find((r) => r.id === id)?.name ?? id ?? ""
  const lock = !canUpdate ? "no_permission" : structural[0] ? parseBlocker(structural[0]).reason : null
  const nameValid = name.trim().length > 0 && name.length <= 120
  const permsChanged = !sameSet(initial, picked)
  const dirty = name.trim() !== subrole.name || description !== subrole.description || permsChanged
  const modulePerms = catalog.filter((p) => p.moduleId === subrole.moduleId)
  const ent = overview.entitlements ? new Set(overview.entitlements) : null
  const copyLock = ent && initial.some((p) => !ent.has(p)) ? "exceeds_authority" : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!nameValid || !dirty || lock) return
    await run(
      () =>
        update({
          subroleId,
          ...(add.length ? { add } : {}),
          ...(remove.length ? { remove } : {}),
          ...(name.trim() !== subrole.name ? { name: name.trim() } : {}),
          ...(description !== subrole.description ? { description } : {}),
        }),
      { success: t("subroles.updated") },
    )
  }

  return (
    <>
      {subrole.origin === "template" && <p className="text-sm text-muted-foreground">{t("subroles.templateNote")}</p>}
      {lock && lock !== "no_permission" && (
        <LockNote reason={lock}>
          {structural.map((b) => {
            const { roleId } = parseBlocker(b)
            return roleId ? (
              <span key={b} className="mt-1 block text-xs">
                {fill(t("subroles.lockedBy"), { role: roleName(roleId) })}: {lockText(parseBlocker(b).reason)}
              </span>
            ) : null
          })}
        </LockNote>
      )}

      <form onSubmit={submit} className="grid gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="subrole-edit-name">{t("common.name")}</FieldLabel>
            <Input id="subrole-edit-name" required maxLength={120} disabled={!!lock} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="subrole-edit-description">{t("common.description")}</FieldLabel>
            <Textarea id="subrole-edit-description" rows={2} disabled={!!lock} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <FieldSet>
            <FieldLegend variant="label">{t("subroles.permissions")}</FieldLegend>
            {canCatalog ? (
              <>
                <FieldDescription>{t("subroles.permissionsHelp")}</FieldDescription>
                <PermissionPicker permissions={modulePerms} entitlements={overview.entitlements} picked={picked} disabled={!!lock} onToggle={(id, on) => setPicked(toggle(picked, id, on))} />
              </>
            ) : (
              <>
                <FieldDescription>{t("subroles.noPermissionCatalog")}</FieldDescription>
                <div className="flex flex-wrap gap-1.5">
                  {initial.map((p) => (
                    <PermissionBadge key={p} id={p} />
                  ))}
                </div>
              </>
            )}
          </FieldSet>
        </FieldGroup>

        {permsChanged && <PermissionDiff added={add} removed={remove} />}

        <section className="grid gap-2" aria-live="polite">
          <h3 className="text-sm font-medium">{t("subroles.impact")}</h3>
          <p className="text-xs text-muted-foreground">{t("subroles.impactLead")}</p>
          {!preview ? (
            <Skeleton className="h-16 w-full" />
          ) : preview.affectedRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("subroles.impactNone")}</p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {preview.affectedRoles.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {r.protected && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{r.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("roles.users")}: {r.users} · {t("roles.apiKeys")}: {r.apiKeys}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{fill(t("subroles.impactTotals"), { users: preview.totalUsers, keys: preview.totalApiKeys })}</p>
            </>
          )}
          {preview?.blockers.includes("exceeds_authority") && <LockNote reason="exceeds_authority" />}
        </section>

        {!lock && (
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-popover px-4 py-3">
            {!dirty && <span className="mr-auto text-xs text-muted-foreground">{t("roles.noChanges")}</span>}
            <Button type="submit" disabled={busy || !dirty || !nameValid || !preview || preview.blockers.length > 0}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </form>

      {(canCopy || canArchive) && (
        <section className="grid gap-3">
          <Separator />
          <div className="flex flex-wrap gap-2">
            {canCopy && (
              <Button type="button" variant="outline" disabled={!!copyLock} onClick={() => setCopying(true)}>
                <Copy />
                {t("subroles.copy")}
              </Button>
            )}
            {canArchive && (
              <Button type="button" variant="destructive" disabled={!preview || structural.length > 0} onClick={() => setArchiving(true)}>
                <Archive />
                {t("subroles.archive")}
              </Button>
            )}
          </div>
          {canCopy && copyLock && <p className="text-xs text-muted-foreground">{`${t("subroles.copy")}: ${lockText(copyLock)}`}</p>}
          {canArchive && structural[0] && <p className="text-xs text-muted-foreground">{`${t("subroles.archive")}: ${lockText(parseBlocker(structural[0]).reason)}`}</p>}
        </section>
      )}

      <NameDialog
        open={copying}
        onOpenChange={setCopying}
        title={t("subroles.copyTitle")}
        lead={t("subroles.copyLead")}
        initialName={`${subrole.name} ${t("roles.copySuffix")}`}
        initialDescription={subrole.description}
        submitLabel={t("common.create")}
        busy={busy}
        onSubmit={async (v) => {
          const res = await run(() => copy({ subroleId, ...v }), { success: t("subroles.copied") })
          if (res) onOpen(res.subroleId)
          return !!res
        }}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("subroles.archiveTitle")}
        confirmLabel={t("subroles.archive")}
        busy={busy}
        onConfirm={() => {
          // Close first: the live preview of an archived subrole would fail with NOT_FOUND.
          setArchiving(false)
          onClose()
          void run(() => archive({ subroleId }), { success: t("subroles.archived") })
        }}
      >
        <p>{t("subroles.archiveLead")}</p>
        {preview && preview.affectedRoles.length > 0 && (
          <p className="font-medium text-foreground">
            {preview.affectedRoles.map((r) => r.name).join(", ")} · {fill(t("subroles.impactTotals"), { users: preview.totalUsers, keys: preview.totalApiKeys })}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
