"use client"
import type { TemplateDetail } from "@digimuza/documents"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { SIGNING_FIELD_TYPES, type PageSize, type SigningField, type SigningFieldType } from "@digimuza/documents/signing"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, FileQuestion, MousePointer2, Plus, Save, Send, Trash2, X } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { PdfPages, type PageBox } from "@/components/documents/pdf-pages"
import { boxStyle, FIELD_ICON, roleColor, roleInk } from "@/components/documents/signing-fields"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { useSigningVisible } from "../../_components/use-documents"
import { SendDialog } from "./send-dialog"

/** Default field sizes in PDF points; a click (not a drag) places one of these. */
const DEFAULT_SIZE: Record<SigningFieldType, { w: number; h: number }> = {
  signature: { w: 170, h: 48 },
  initials: { w: 70, h: 40 },
  text: { w: 170, h: 22 },
  name: { w: 170, h: 22 },
  email: { w: 190, h: 22 },
  date: { w: 100, h: 22 },
  checkbox: { w: 16, h: 16 },
}
const MIN = 0.01
const newId = () => Math.random().toString(36).slice(2, 10)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round = (n: number) => Math.round(n * 10_000) / 10_000

function fit(f: SigningField): SigningField {
  const w = clamp(f.w, MIN, 1)
  const h = clamp(f.h, MIN, 1)
  return { ...f, w: round(w), h: round(h), x: round(clamp(f.x, 0, 1 - w)), y: round(clamp(f.y, 0, 1 - h)) }
}

export function TemplateBuilder({ templateId }: { templateId: string }) {
  const { t } = useT()
  const visible = useSigningVisible()
  const tpl = useQuery(api.documents.getTemplate, visible ? { templateId } : "skip")
  if (!visible) return <p className="p-8 text-sm text-muted-foreground">{t("sign.off")}</p>
  if (tpl === undefined)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="flex flex-1 justify-center bg-muted/40 p-6">
          <Skeleton className="aspect-[1/1.414] w-full max-w-3xl rounded-none" />
        </div>
      </div>
    )
  if (tpl === null)
    return (
      <div className="p-8">
        <EmptyState icon={<FileQuestion />} title={t("sign.templates.missing")} action={<Button asChild variant="outline"><Link href="/app/documents/templates">{t("sign.templates.back")}</Link></Button>} />
      </div>
    )
  return <Builder key={tpl.id} tpl={tpl} />
}

type Drag =
  | { kind: "create"; id: string; page: number; rect: DOMRect; ax: number; ay: number }
  | { kind: "move" | "resize"; id: string; rect: DOMRect; sx: number; sy: number; orig: SigningField; moved: boolean }

function Builder({ tpl }: { tpl: TemplateDetail }) {
  const { t } = useT()
  const canEdit = useCan(DocumentsPermissions.manageTemplates) && !tpl.archived
  const canSend = useCan(DocumentsPermissions.signingSend) && !tpl.archived
  const update = useMutation(api.documents.updateTemplate)
  const { run, busy } = useAction()

  const [name, setName] = useState(tpl.name)
  const [roles, setRoles] = useState(tpl.roles)
  const [fields, setFields] = useState<SigningField[]>(tpl.fields)
  const [saved, setSaved] = useState(() => JSON.stringify({ name: tpl.name, roles: tpl.roles, fields: tpl.fields }))
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<SigningFieldType | null>(null)
  const [activeRole, setActiveRole] = useState(0)
  const [sendOpen, setSendOpen] = useState(false)
  const drag = useRef<Drag | null>(null)

  const dirty = JSON.stringify({ name, roles, fields }) !== saved
  const current = fields.find((f) => f.id === selected) ?? null
  const hasSignature = fields.some((f) => f.type === "signature" || f.type === "initials")

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    // In-app links (the sidebar) navigate without unloading: ask before leaving unsaved fields.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]")
      if (!link || link.closest("[data-builder-back]") || e.defaultPrevented) return
      if (!window.confirm(t("sign.builder.leaveConfirm"))) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", warn)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", warn)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty, t])

  const patchField = useCallback((id: string, patch: Partial<SigningField>) => setFields((fs) => fs.map((f) => (f.id === id ? fit({ ...f, ...patch }) : f))), [])
  const removeField = useCallback((id: string) => {
    setFields((fs) => fs.filter((f) => f.id !== id))
    setSelected(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest("input, textarea, select, [contenteditable], [role=dialog], [role=listbox]")) return
      if (e.key === "Escape") {
        setTool(null)
        setSelected(null)
      }
      if (!canEdit || !selected) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        removeField(selected)
      }
      const step = e.shiftKey ? 0.01 : 0.002
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const d = nudge[e.key]
      if (d) {
        e.preventDefault()
        setFields((fs) => fs.map((f) => (f.id === selected ? fit({ ...f, x: f.x + d[0], y: f.y + d[1] }) : f)))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [canEdit, selected, removeField])

  // Pointer moves are tracked on the window so a drag can leave the field (or the page).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const fx = (e.clientX - d.rect.left) / d.rect.width
      const fy = (e.clientY - d.rect.top) / d.rect.height
      if (d.kind === "create") {
        const x = clamp(Math.min(d.ax, fx), 0, 1)
        const y = clamp(Math.min(d.ay, fy), 0, 1)
        setFields((fs) => fs.map((f) => (f.id === d.id ? { ...f, x, y, w: clamp(Math.abs(fx - d.ax), 0, 1 - x), h: clamp(Math.abs(fy - d.ay), 0, 1 - y) } : f)))
      } else {
        const dx = fx - d.sx
        const dy = fy - d.sy
        if (Math.abs(dx) + Math.abs(dy) > 0.002) d.moved = true
        setFields((fs) => fs.map((f) => (f.id !== d.id ? f : d.kind === "move" ? fit({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }) : fit({ ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy }))))
      }
    }
    const onUp = () => {
      const d = drag.current
      drag.current = null
      if (d?.kind !== "create") return
      setFields((fs) =>
        fs.map((f) => {
          if (f.id !== d.id) return f
          if (f.w >= MIN * 2 && f.h >= MIN) return fit(f)
          // A click: place the default size, centred on the pointer.
          const page = tpl.pages[d.page]!
          const size = DEFAULT_SIZE[f.type]
          const w = size.w / page.width
          const h = size.h / page.height
          return fit({ ...f, x: d.ax - w / 2, y: d.ay - h / 2, w, h })
        }),
      )
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [tpl.pages])

  function startCreate(e: ReactPointerEvent<HTMLDivElement>, page: number) {
    if (!canEdit || !tool || e.button !== 0) {
      if (e.target === e.currentTarget) setSelected(null)
      return
    }
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const ax = (e.clientX - rect.left) / rect.width
    const ay = (e.clientY - rect.top) / rect.height
    const id = newId()
    const role = clamp(activeRole, 0, roles.length - 1)
    setFields((fs) => [...fs, { id, type: tool, role, label: "", required: tool !== "checkbox", page, x: ax, y: ay, w: 0, h: 0 }])
    setSelected(id)
    drag.current = { kind: "create", id, page, rect, ax, ay }
  }

  function startDrag(e: ReactPointerEvent, f: SigningField, kind: "move" | "resize") {
    e.stopPropagation()
    setSelected(f.id)
    if (!canEdit || e.button !== 0) return
    e.preventDefault()
    const pageEl = (e.currentTarget as HTMLElement).closest("[data-overlay]") as HTMLElement
    const rect = pageEl.getBoundingClientRect()
    drag.current = { kind, id: f.id, rect, sx: (e.clientX - rect.left) / rect.width, sy: (e.clientY - rect.top) / rect.height, orig: f, moved: false }
  }

  function removeRole(i: number) {
    const used = fields.filter((f) => f.role === i).length
    if (used && !window.confirm(t("sign.builder.removeRoleConfirm").replace("{n}", String(used)))) return
    setRoles((rs) => rs.filter((_, j) => j !== i))
    setFields((fs) => fs.filter((f) => f.role !== i).map((f) => (f.role > i ? { ...f, role: f.role - 1 } : f)))
    setActiveRole((r) => (r >= i ? Math.max(0, r - 1) : r))
  }

  async function save() {
    const res = await run(() => update({ templateId: tpl.id as Id<"docTemplates">, name: name.trim(), roles: roles.map((r) => r.trim()), fields }), { success: t("sign.builder.saved") })
    if (res) setSaved(JSON.stringify({ name: name.trim(), roles: roles.map((r) => r.trim()), fields }))
    return Boolean(res)
  }

  async function openSend() {
    if (dirty && canEdit && !(await save())) return
    setSendOpen(true)
  }

  const overlay = useCallback(
    (page: PageBox) => (
      <div data-overlay className={cn("absolute inset-0", canEdit && tool && "cursor-crosshair")} onPointerDown={(e) => startCreate(e, page.index)}>
        {fields
          .filter((f) => f.page === page.index)
          .map((f) => (
            <FieldBox key={f.id} field={f} role={roles[f.role] ?? ""} selected={f.id === selected} canEdit={canEdit} pxHeight={f.h * page.height} onPointerDown={(e) => startDrag(e, f, "move")} onResize={(e) => startDrag(e, f, "resize")} onSelect={() => setSelected(f.id)} label={t(`sign.field.${f.type}` as MessageKey)} />
          ))}
      </div>
    ),
    // startCreate/startDrag read the latest state through closures; re-create with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, roles, selected, canEdit, tool, activeRole, t],
  )

  const perRole = useMemo(() => roles.map((_, i) => fields.filter((f) => f.role === i).length), [roles, fields])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link data-builder-back href="/app/documents/templates" aria-label={t("sign.templates.back")} onClick={(e) => dirty && !window.confirm(t("sign.builder.leaveConfirm")) && e.preventDefault()}>
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={!canEdit}
          aria-label={t("sign.templates.name")}
          maxLength={200}
          className="h-8 max-w-md flex-1 border-transparent bg-transparent px-2 text-base font-semibold shadow-none hover:border-input focus-visible:border-ring"
        />
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {tpl.archived ? t("sign.builder.archived") : !canEdit ? t("sign.builder.readOnly") : dirty ? t("sign.builder.unsaved") : t("sign.builder.allSaved")}
        </span>
        {canEdit && (
          <Button variant="outline" size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            <Save /> {t("sign.save")}
          </Button>
        )}
        {canSend && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button size="sm" disabled={!hasSignature || busy} onClick={() => void openSend()}>
                  <Send /> {t("sign.send.action")}
                </Button>
              </span>
            </TooltipTrigger>
            {!hasSignature && <TooltipContent>{t("sign.builder.needSignature")}</TooltipContent>}
          </Tooltip>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-[60vh] min-w-0 flex-1 overflow-y-auto bg-muted/50 px-4 py-6 md:px-8" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <PdfPages url={tpl.fileUrl} pages={tpl.pages} maxWidth={880} overlay={overlay} />
        </main>

        <aside className="w-full shrink-0 overflow-y-auto border-t bg-background lg:w-80 lg:border-t-0 lg:border-l">
          <div className="grid gap-5 p-4">
            {current ? (
              <Inspector field={current} roles={roles} canEdit={canEdit} onChange={(p) => patchField(current.id, p)} onDelete={() => removeField(current.id)} onClose={() => setSelected(null)} />
            ) : (
              <>
                <section className="grid gap-2" aria-labelledby="roles-h">
                  <h2 id="roles-h" className="text-sm font-medium">
                    {t("sign.builder.roles")}
                  </h2>
                  <p className="text-xs text-muted-foreground">{t("sign.builder.rolesHint")}</p>
                  <ul className="grid gap-1.5">
                    {roles.map((r, i) => (
                      <li key={i} className={cn("flex items-center gap-2 rounded-lg border p-1.5 pl-2.5 transition-colors", activeRole === i && "border-foreground/30 bg-muted/60")}>
                        <button type="button" className="flex size-5 shrink-0 items-center justify-center rounded-full outline-offset-2" onClick={() => setActiveRole(i)} aria-label={t("sign.builder.useRole").replace("{role}", r)} aria-pressed={activeRole === i}>
                          <span className="size-3 rounded-full" style={{ background: roleColor(i), boxShadow: activeRole === i ? `0 0 0 3px ${roleColor(i, 0.25)}` : undefined }} />
                        </button>
                        <Input value={r} readOnly={!canEdit} onChange={(e) => setRoles((rs) => rs.map((x, j) => (j === i ? e.target.value : x)))} onFocus={() => setActiveRole(i)} aria-label={t("sign.builder.roleName")} maxLength={60} className="h-7 flex-1 border-transparent px-1.5 shadow-none hover:border-input" />
                        <span className="w-5 text-right text-xs text-muted-foreground tabular-nums" title={t("sign.templates.fields")}>
                          {perRole[i]}
                        </span>
                        {canEdit && roles.length > 1 && (
                          <Button size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={t("sign.builder.removeRole")} onClick={() => removeRole(i)}>
                            <X />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canEdit && roles.length < 10 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-muted-foreground"
                      onClick={() => {
                        setRoles((rs) => [...rs, `${t("sign.builder.roleDefault")} ${rs.length + 1}`])
                        setActiveRole(roles.length)
                      }}
                    >
                      <Plus /> {t("sign.builder.addRole")}
                    </Button>
                  )}
                </section>

                {canEdit && (
                  <>
                    <Separator />
                    <section className="grid gap-2" aria-labelledby="palette-h">
                      <h2 id="palette-h" className="text-sm font-medium">
                        {t("sign.builder.fields")}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t("sign.builder.fieldsHint")} <span className="font-medium text-foreground">{roles[activeRole]}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <PaletteButton active={tool === null} onClick={() => setTool(null)} icon={<MousePointer2 />} label={t("sign.builder.select")} />
                        {SIGNING_FIELD_TYPES.map((type) => {
                          const Icon = FIELD_ICON[type]
                          return <PaletteButton key={type} active={tool === type} onClick={() => setTool(tool === type ? null : type)} icon={<Icon />} label={t(`sign.field.${type}` as MessageKey)} color={tool === type ? roleColor(activeRole) : undefined} />
                        })}
                      </div>
                      {tool && <p className="text-xs text-muted-foreground">{t("sign.builder.placeHint")}</p>}
                    </section>
                  </>
                )}

                <Separator />
                <FieldSummary fields={fields} pages={tpl.pages} roles={roles} onPick={setSelected} />
              </>
            )}
          </div>
        </aside>
      </div>

      {sendOpen && <SendDialog open onOpenChange={setSendOpen} templateId={tpl.id} templateName={name} roles={roles} rolesWithFields={[...new Set(fields.map((f) => f.role))]} />}
    </div>
  )
}

function PaletteButton({ active, onClick, icon, label, color }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color?: string | undefined }) {
  return (
    <Button type="button" variant={active ? "secondary" : "outline"} size="sm" aria-pressed={active} onClick={onClick} className={cn("justify-start", active && "ring-1 ring-foreground/20")} style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  )
}

function FieldBox({
  field: f,
  role,
  label,
  selected,
  canEdit,
  pxHeight,
  onPointerDown,
  onResize,
  onSelect,
}: {
  field: SigningField
  role: string
  label: string
  selected: boolean
  canEdit: boolean
  pxHeight: number
  onPointerDown: (e: ReactPointerEvent) => void
  onResize: (e: ReactPointerEvent) => void
  onSelect: () => void
}) {
  const Icon = FIELD_ICON[f.type]
  const compact = pxHeight < 22
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}${f.label ? `: ${f.label}` : ""} · ${role}`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      className={cn("group absolute flex touch-none items-center gap-1 overflow-hidden rounded-[3px] border-[1.5px] px-1 text-[11px] leading-none font-medium select-none outline-none", canEdit ? "cursor-move" : "cursor-pointer", selected && "z-10")}
      style={{
        ...boxStyle(f),
        borderColor: roleColor(f.role),
        background: roleColor(f.role, selected ? 0.22 : 0.12),
        color: roleInk(f.role),
        boxShadow: selected ? `0 0 0 2px var(--background), 0 0 0 4px ${roleColor(f.role, 0.6)}` : undefined,
      }}
    >
      {!compact && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {!compact && <span className="truncate">{f.label || label}</span>}
      {f.required && !compact && <span aria-hidden="true">*</span>}
      {selected && canEdit && (
        <span
          onPointerDown={onResize}
          aria-hidden="true"
          className="absolute right-0 bottom-0 size-2.5 cursor-nwse-resize rounded-tl-[2px]"
          style={{ background: roleColor(f.role) }}
        />
      )}
    </div>
  )
}

function Inspector({ field, roles, canEdit, onChange, onDelete, onClose }: { field: SigningField; roles: string[]; canEdit: boolean; onChange: (p: Partial<SigningField>) => void; onDelete: () => void; onClose: () => void }) {
  const { t } = useT()
  return (
    <section className="grid gap-4" aria-labelledby="inspector-h">
      <div className="flex items-center gap-2">
        <h2 id="inspector-h" className="flex-1 text-sm font-medium">
          {t("sign.builder.field")}
        </h2>
        <Button size="icon-sm" variant="ghost" aria-label={t("sign.close")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="f-type">{t("sign.builder.type")}</FieldLabel>
          <Select value={field.type} disabled={!canEdit} onValueChange={(v) => onChange({ type: v as SigningFieldType })}>
            <SelectTrigger id="f-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIGNING_FIELD_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`sign.field.${type}` as MessageKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-role">{t("sign.builder.role")}</FieldLabel>
          <Select value={String(field.role)} disabled={!canEdit} onValueChange={(v) => onChange({ role: Number(v) })}>
            <SelectTrigger id="f-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r, i) => (
                <SelectItem key={i} value={String(i)}>
                  <span className="size-2 rounded-full" style={{ background: roleColor(i) }} aria-hidden="true" />
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-label">{t("sign.builder.label")}</FieldLabel>
          <Input id="f-label" value={field.label} readOnly={!canEdit} onChange={(e) => onChange({ label: e.target.value })} maxLength={100} placeholder={t(`sign.field.${field.type}` as MessageKey)} />
        </Field>
        <Field orientation="horizontal">
          <Switch id="f-required" checked={field.required} disabled={!canEdit} onCheckedChange={(required) => onChange({ required })} />
          <FieldLabel htmlFor="f-required">{t("sign.builder.required")}</FieldLabel>
        </Field>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">
        {t("sign.builder.page")} {field.page + 1} · {t("sign.builder.keysHint")}
      </p>
      {canEdit && (
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 /> {t("sign.builder.deleteField")}
        </Button>
      )}
    </section>
  )
}

function FieldSummary({ fields, pages, roles, onPick }: { fields: SigningField[]; pages: PageSize[]; roles: string[]; onPick: (id: string) => void }) {
  const { t } = useT()
  if (fields.length === 0) return <p className="text-sm text-muted-foreground">{t("sign.builder.noFields")}</p>
  return (
    <section className="grid gap-2" aria-labelledby="list-h">
      <h2 id="list-h" className="text-sm font-medium">
        {t("sign.builder.placed")} <span className="font-normal text-muted-foreground tabular-nums">{fields.length}</span>
      </h2>
      <ul className="grid gap-0.5">
        {[...fields]
          .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
          .map((f) => {
            const Icon = FIELD_ICON[f.type]
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => {
                    onPick(f.id)
                    document.querySelector(`[data-page="${f.page}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }}
                >
                  <Icon className="size-3.5 shrink-0" style={{ color: roleColor(f.role) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{f.label || t(`sign.field.${f.type}` as MessageKey)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {roles[f.role]} · {t("sign.pagesShort")} {f.page + 1}/{pages.length}
                  </span>
                </button>
              </li>
            )
          })}
      </ul>
    </section>
  )
}
