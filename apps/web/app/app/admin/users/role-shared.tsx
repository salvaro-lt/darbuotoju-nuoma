"use client"
import { SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Lock, Minus, Plus } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages"
import { byModule } from "@/lib/roles"

export type Overview = FunctionReturnType<typeof api.roleAdmin.overview>
export type Subrole = FunctionReturnType<typeof api.system.listSubroles>[number]
export type Permission = FunctionReturnType<typeof api.system.listPermissions>[number]

/** Locks, subrole permissions and user→roles for the editor; undefined while loading or without roles:role:read. */
export function useOverview(): Overview | undefined {
  const canRoles = useCan(P.rolesRead)
  return useQuery(api.roleAdmin.overview, canRoles ? {} : "skip")
}

/** Permission catalog (names) when the viewer may read it; [] otherwise, undefined while loading. */
export function usePermissionCatalog(): Permission[] | undefined {
  const canRead = useCan(P.permissionsRead)
  const rows = useQuery(api.system.listPermissions, canRead ? {} : "skip")
  return canRead ? rows?.filter((p) => p.status === "active") : []
}

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

/** Message for one of core's forbidden reasons (or a UI one like `no_permission`). */
export function useLockText() {
  const { t } = useT()
  return (reason: string) => {
    const key = `roles.lock.${reason}`
    return key in MESSAGES.en ? t(key as MessageKey) : t("roles.lock.unknown")
  }
}

/** Explains why something is read-only, in the words of core's refusal reason. */
export function LockNote({ reason, children }: { reason: string; children?: ReactNode }) {
  const { t } = useT()
  const text = useLockText()
  return (
    <Alert>
      <Lock />
      <AlertTitle>{t("roles.locked")}</AlertTitle>
      <AlertDescription>
        {text(reason)}
        {children}
      </AlertDescription>
    </Alert>
  )
}

export function PermissionBadge({ id, tone }: { id: string; tone?: "added" | "removed" }) {
  return (
    <Badge variant={tone === "removed" ? "destructive" : tone === "added" ? "secondary" : "outline"} className="max-w-full font-mono text-[11px] font-normal">
      {tone === "added" && <Plus />}
      {tone === "removed" && <Minus />}
      <span className="truncate">{id}</span>
    </Badge>
  )
}

/** Added / removed permissions before saving. */
export function PermissionDiff({ added, removed, footer }: { added: string[]; removed: string[]; footer?: ReactNode }) {
  const { t } = useT()
  const none = added.length === 0 && removed.length === 0
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/40 p-3" aria-live="polite">
      <div>
        <h4 className="text-sm font-medium">{t("roles.preview")}</h4>
        <p className="text-xs text-muted-foreground">{none ? t("roles.previewNone") : t("roles.previewLead")}</p>
      </div>
      {added.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">{t("roles.added")}</span>
          <div className="flex flex-wrap gap-1.5">
            {added.map((p) => (
              <PermissionBadge key={p} id={p} tone="added" />
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">{t("roles.removed")}</span>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((p) => (
              <PermissionBadge key={p} id={p} tone="removed" />
            ))}
          </div>
        </div>
      )}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
    </div>
  )
}

/**
 * Subroles grouped by module, each with its permissions. Subroles granting
 * permissions outside `entitlements` (non-Super) are disabled: core would refuse.
 */
export function SubrolePicker({
  subroles,
  subrolePermissions,
  entitlements,
  picked,
  onToggle,
  disabled,
}: {
  subroles: Subrole[]
  subrolePermissions: Record<string, string[]>
  entitlements: string[] | null
  picked: string[]
  onToggle: (id: string, on: boolean) => void
  disabled?: boolean
}) {
  const { t } = useT()
  const ent = entitlements ? new Set(entitlements) : null
  return (
    <div className="grid gap-4">
      {byModule(subroles).map(([moduleId, list]) => (
        <div key={moduleId} className="grid gap-2">
          <span className="font-mono text-xs text-muted-foreground">{moduleId}</span>
          {list.map((s) => {
            const perms = subrolePermissions[s.key] ?? []
            const exceeds = !!ent && perms.some((p) => !ent.has(p))
            const checked = picked.includes(s.key)
            // Removing is always allowed; adding a subrole beyond your authority is not.
            const off = disabled || (exceeds && !checked)
            return (
              <Label key={s.key} className="flex items-start gap-2 rounded-md border p-2 font-normal has-[[data-state=checked]]:bg-muted/50">
                <Checkbox className="mt-0.5" checked={checked} disabled={off} onCheckedChange={(v) => onToggle(s.key, v === true)} />
                <span className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{s.name}</span>
                    {exceeds && <span className="text-xs text-destructive">{t("roles.exceeds")}</span>}
                  </span>
                  {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
                  <span className="flex flex-wrap gap-1">
                    {perms.map((p) => (
                      <PermissionBadge key={p} id={p} />
                    ))}
                  </span>
                </span>
              </Label>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Name + description prompt for copies. Returns true from `onSubmit` to close. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  lead,
  initialName,
  initialDescription,
  submitLabel,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  lead: string
  initialName: string
  initialDescription: string
  submitLabel: string
  busy: boolean
  onSubmit: (v: { name: string; description: string }) => Promise<boolean>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <NameForm {...{ title, lead, initialName, initialDescription, submitLabel, busy, onSubmit }} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  lead,
  initialName,
  initialDescription,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string
  lead: string
  initialName: string
  initialDescription: string
  submitLabel: string
  busy: boolean
  onSubmit: (v: { name: string; description: string }) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useT()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const valid = name.trim().length > 0 && name.length <= 120
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (valid && (await onSubmit({ name: name.trim(), description }))) onCancel()
  }
  return (
    <form onSubmit={submit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{lead}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="copy-name">{t("common.name")}</FieldLabel>
          <Input id="copy-name" required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="copy-description">{t("common.description")}</FieldLabel>
          <Textarea id="copy-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !valid}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Destructive confirmation. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
}) {
  const { t } = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-2">{children}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
