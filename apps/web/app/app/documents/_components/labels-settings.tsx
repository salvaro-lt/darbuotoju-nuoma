"use client"
import { CUSTOM_FIELD_TYPES, MATCH_ALGORITHMS, type CustomFieldType, type CustomFieldView, type DocumentsLabels, type LabelKind, type LabelView, type MatchAlgorithm, type SavedViewView, type TagView } from "@digimuza/documents"
import { DocumentsFlags } from "@digimuza/documents/manifest"
import { useFeatureFlag } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Building2, FileType2, Inbox, LayoutList, ListPlus, Pencil, Plus, Tags, Trash2 } from "lucide-react"
import Link from "next/link"
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { documentHref, useDocumentsEnabled, useLabels } from "./use-documents"
import { TagChip } from "./labels-ui"

// A calm, distinguishable palette for new tags; any hex colour is accepted.
const COLORS = ["#64748b", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899"]

export function LabelsSettings() {
  const { t } = useT()
  const enabled = useDocumentsEnabled()
  const labels = useLabels()
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("docs.disabled")}</p>
  return (
    <div>
      <PageHeader title={t("docs.labels.title")} lead={t("docs.labels.lead")} />
      {!labels ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <Tabs defaultValue="tag">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="tag">{t("docs.labels.tab.tags")}</TabsTrigger>
            <TabsTrigger value="correspondent">{t("docs.labels.tab.correspondents")}</TabsTrigger>
            <TabsTrigger value="type">{t("docs.labels.tab.types")}</TabsTrigger>
            <TabsTrigger value="fields">{t("docs.labels.tab.fields")}</TabsTrigger>
            <TabsTrigger value="views">{t("docs.labels.tab.views")}</TabsTrigger>
          </TabsList>
          <TabsContent value="tag" className="pt-4">
            <LabelList kind="tag" items={labels.tags} icon={<Tags />} />
          </TabsContent>
          <TabsContent value="correspondent" className="pt-4">
            <LabelList kind="correspondent" items={labels.correspondents} icon={<Building2 />} />
          </TabsContent>
          <TabsContent value="type" className="pt-4">
            <LabelList kind="type" items={labels.types} icon={<FileType2 />} />
          </TabsContent>
          <TabsContent value="fields" className="pt-4">
            <FieldList fields={labels.customFields} />
          </TabsContent>
          <TabsContent value="views" className="pt-4">
            <ViewList views={labels.views} labels={labels} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- tags, correspondents, types

function LabelList({ kind, items, icon }: { kind: LabelKind; items: (LabelView | TagView)[]; icon: ReactNode }) {
  const { t } = useT()
  const [editing, setEditing] = useState<LabelView | TagView | "new" | null>(null)
  const [deleting, setDeleting] = useState<LabelView | null>(null)
  const del = useMutation(api.documents.deleteLabel)
  const { run, busy } = useAction()
  const newButton = (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus />
      {t(`docs.labels.new.${kind}` as MessageKey)}
    </Button>
  )
  return (
    <div className="grid gap-3">
      {items.length === 0 ? (
        <EmptyState icon={icon} title={t(`docs.labels.new.${kind}` as MessageKey)} body={t(`docs.labels.empty.${kind}` as MessageKey)} action={newButton} />
      ) : (
        <>
          <div className="flex justify-end">{newButton}</div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.labels.name")}</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.labels.algorithm")}</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.labels.match")}</TableHead>
                  <TableHead className="px-4 text-right text-xs font-medium text-muted-foreground">{t("docs.labels.count")}</TableHead>
                  <TableHead className="w-20 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="px-4">{"color" in l ? <TagChip tag={l} /> : <span className="font-medium">{l.name}</span>}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{t(`docs.algo.${l.algorithm}` as MessageKey)}</TableCell>
                    <TableCell className="max-w-64 truncate px-4 font-mono text-xs">{l.algorithm === "none" || l.algorithm === "auto" ? "" : l.match}</TableCell>
                    <TableCell className="px-4 text-right tabular-nums">{l.count}</TableCell>
                    <TableCell className="px-4">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.edit")}: ${l.name}`} onClick={() => setEditing(l)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.delete")}: ${l.name}`} onClick={() => setDeleting(l)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {editing && <LabelDialog kind={kind} label={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        name={deleting?.name ?? ""}
        body={t("docs.labels.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => del({ kind, id: deleting!.id }), { success: t("docs.labels.deleted") }).then((r) => {
            if (r) setDeleting(null)
          })
        }
      />
    </div>
  )
}

function LabelDialog({ kind, label, onClose }: { kind: LabelKind; label: LabelView | TagView | null; onClose: () => void }) {
  const { t } = useT()
  const aiOn = useFeatureFlag(DocumentsFlags.ai)
  const create = useMutation(api.documents.createLabel)
  const update = useMutation(api.documents.updateLabel)
  const { run, busy } = useAction()
  const tag = label && "color" in label ? label : null
  const [name, setName] = useState(label?.name ?? "")
  const [color, setColor] = useState(() => tag?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]!)
  const [isInbox, setIsInbox] = useState(tag?.isInbox ?? false)
  const [algorithm, setAlgorithm] = useState<MatchAlgorithm>(label?.algorithm ?? "any")
  const [match, setMatch] = useState(label?.match ?? "")
  const [caseSensitive, setCaseSensitive] = useState(label?.caseSensitive ?? false)
  const needsMatch = algorithm !== "none" && algorithm !== "auto"

  async function submit(e: FormEvent) {
    e.preventDefault()
    const rule = { match: needsMatch ? match : "", algorithm, caseSensitive }
    const extra = kind === "tag" ? { color, isInbox } : {}
    const res = label
      ? await run(() => update({ kind, id: label.id, name, ...rule, ...extra }), { success: t("docs.labels.saved") })
      : await run(() => create({ kind, name, ...rule, ...extra }), { success: t("docs.labels.created") })
    if (res) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{label ? t(`docs.labels.edit.${kind}` as MessageKey) : t(`docs.labels.new.${kind}` as MessageKey)}</DialogTitle>
            <DialogDescription>{t("docs.labels.lead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="label-name">{t("docs.labels.name")}</FieldLabel>
              <Input id="label-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
            </Field>
            {kind === "tag" && (
              <>
                <Field>
                  <FieldLabel htmlFor="label-color">{t("docs.labels.color")}</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={color === c}
                        onClick={() => setColor(c)}
                        className="size-6 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-foreground"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <Input id="label-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-10 p-0.5" />
                    <TagChip tag={{ name: name || "…", color, isInbox }} />
                  </div>
                </Field>
                <Field orientation="horizontal">
                  <Switch id="label-inbox" checked={isInbox} onCheckedChange={setIsInbox} />
                  <div className="grid gap-0.5">
                    <Label htmlFor="label-inbox" className="flex items-center gap-1.5">
                      <Inbox className="size-3.5" aria-hidden />
                      {t("docs.labels.inbox")}
                    </Label>
                    <FieldDescription>{t("docs.labels.inboxHint")}</FieldDescription>
                  </div>
                </Field>
              </>
            )}
            <Field>
              <FieldLabel htmlFor="label-algo">{t("docs.labels.algorithm")}</FieldLabel>
              <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as MatchAlgorithm)}>
                <SelectTrigger id="label-algo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_ALGORITHMS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`docs.algo.${a}` as MessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t(`docs.algo.${algorithm}.hint` as MessageKey)}</FieldDescription>
            </Field>
            {algorithm === "auto" && !aiOn && (
              <Alert>
                <AlertDescription>{t("docs.labels.aiOff")}</AlertDescription>
              </Alert>
            )}
            {needsMatch && (
              <>
                <Field>
                  <FieldLabel htmlFor="label-match">{t("docs.labels.match")}</FieldLabel>
                  <Input id="label-match" value={match} onChange={(e) => setMatch(e.target.value)} maxLength={500} className="font-mono text-sm" required />
                  {(algorithm === "any" || algorithm === "all") && <FieldDescription>{t("docs.labels.matchHint")}</FieldDescription>}
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={caseSensitive} onCheckedChange={(v) => setCaseSensitive(v === true)} />
                  {t("docs.labels.caseSensitive")}
                </label>
              </>
            )}
            <RulePreview match={match} algorithm={algorithm} caseSensitive={caseSensitive} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("docs.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {label ? t("docs.save") : t("docs.labels.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** How the rule would apply to the newest documents, live. */
function RulePreview({ match, algorithm, caseSensitive }: { match: string; algorithm: MatchAlgorithm; caseSensitive: boolean }) {
  const { t } = useT()
  const rule = useDeferredValue({ match, algorithm, caseSensitive })
  const active = rule.algorithm !== "none" && rule.algorithm !== "auto" && rule.match.trim().length > 0
  const res = useQuery(api.documents.testRule, active ? rule : "skip")
  return (
    <section className="rounded-lg bg-muted/60 p-3 text-sm" aria-live="polite" aria-label={t("docs.labels.preview")}>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("docs.labels.preview")}</h3>
      {!active ? (
        <p className="text-muted-foreground">{t("docs.labels.previewOff")}</p>
      ) : !res ? (
        <Skeleton className="h-5 w-40" />
      ) : res.problem ? (
        <p className="text-destructive">{t("error.VALIDATION")}</p>
      ) : res.matched === 0 ? (
        <p className="text-muted-foreground">{t("docs.labels.previewNone")}</p>
      ) : (
        <div className="grid gap-1">
          <p className="tabular-nums">
            {t("docs.labels.previewCount")}: {res.matched} / {res.scanned}
          </p>
          <ul className="grid gap-0.5">
            {res.examples.map((d) => (
              <li key={d.id} className="truncate">
                <Link href={documentHref(d.id)} target="_blank" className="underline-offset-2 hover:underline">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- custom fields

function FieldList({ fields }: { fields: CustomFieldView[] }) {
  const { t } = useT()
  const [editing, setEditing] = useState<CustomFieldView | "new" | null>(null)
  const [deleting, setDeleting] = useState<CustomFieldView | null>(null)
  const del = useMutation(api.documents.deleteCustomField)
  const { run, busy } = useAction()
  const newButton = (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus />
      {t("docs.fields.new")}
    </Button>
  )
  return (
    <div className="grid gap-3">
      {fields.length === 0 ? (
        <EmptyState icon={<ListPlus />} title={t("docs.fields.new")} body={t("docs.fields.empty")} action={newButton} />
      ) : (
        <>
          <div className="flex justify-end">{newButton}</div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.labels.name")}</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.fields.type")}</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.fields.options")}</TableHead>
                  <TableHead className="w-20 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="px-4 font-medium">{f.name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">{t(`docs.fields.type.${f.type}` as MessageKey)}</TableCell>
                    <TableCell className="max-w-72 truncate px-4 text-muted-foreground">{f.options.join(", ")}</TableCell>
                    <TableCell className="px-4">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.edit")}: ${f.name}`} onClick={() => setEditing(f)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.delete")}: ${f.name}`} onClick={() => setDeleting(f)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {editing && <FieldDialog field={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        name={deleting?.name ?? ""}
        body={t("docs.fields.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => del({ id: deleting!.id }), { success: t("docs.labels.deleted") }).then((r) => {
            if (r) setDeleting(null)
          })
        }
      />
    </div>
  )
}

function FieldDialog({ field, onClose }: { field: CustomFieldView | null; onClose: () => void }) {
  const { t } = useT()
  const create = useMutation(api.documents.createCustomField)
  const update = useMutation(api.documents.updateCustomField)
  const { run, busy } = useAction()
  const [name, setName] = useState(field?.name ?? "")
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text")
  const [options, setOptions] = useState((field?.options ?? []).join("\n"))
  const list = options
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = field
      ? await run(() => update({ id: field.id as Id<"docCustomFields">, name, ...(field.type === "select" ? { options: list } : {}) }), { success: t("docs.labels.saved") })
      : await run(() => create({ name, type, ...(type === "select" ? { options: list } : {}) }), { success: t("docs.labels.created") })
    if (res) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{field ? field.name : t("docs.fields.new")}</DialogTitle>
            <DialogDescription>{t("docs.fields.empty")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="cf-name">{t("docs.labels.name")}</FieldLabel>
              <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="cf-type">{t("docs.fields.type")}</FieldLabel>
              <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)} disabled={!!field}>
                <SelectTrigger id="cf-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`docs.fields.type.${x}` as MessageKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {type === "select" && (
              <Field>
                <FieldLabel htmlFor="cf-options">{t("docs.fields.options")}</FieldLabel>
                <Textarea id="cf-options" value={options} onChange={(e) => setOptions(e.target.value)} rows={5} required />
                <FieldDescription>{t("docs.fields.optionsHint")}</FieldDescription>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("docs.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || (type === "select" && list.length === 0)}>
              {field ? t("docs.save") : t("docs.labels.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- saved views

function ViewList({ views, labels }: { views: SavedViewView[]; labels: DocumentsLabels }) {
  const { t } = useT()
  const save = useMutation(api.documents.saveView)
  const del = useMutation(api.documents.deleteView)
  const { run, busy } = useAction()
  const [deleting, setDeleting] = useState<SavedViewView | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  if (views.length === 0) return <EmptyState icon={<LayoutList />} title={t("docs.labels.tab.views")} body={t("docs.views.empty")} />
  const name = (id: string | undefined, from: { id: string; name: string }[]) => (id ? from.find((x) => x.id === id)?.name : undefined)
  const describe = (v: SavedViewView) =>
    [
      v.filters.search && `“${v.filters.search}”`,
      ...(v.filters.tagIds ?? []).map((id) => name(id, labels.tags)).filter(Boolean),
      v.filters.withoutTags && t("docs.filter.withoutTags"),
      name(v.filters.correspondentId, labels.correspondents),
      name(v.filters.typeId, labels.types),
      (v.filters.from || v.filters.to) && `${v.filters.from ?? "…"} – ${v.filters.to ?? "…"}`,
    ]
      .filter(Boolean)
      .join(" · ")
  const patch = (v: SavedViewView, p: Partial<Pick<SavedViewView, "name" | "showInSidebar">>) =>
    run(() => save({ id: v.id as Id<"docSavedViews">, name: p.name ?? v.name, filters: v.filters, showInSidebar: p.showInSidebar ?? v.showInSidebar }), { success: t("docs.view.saved") })

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.view.name")}</TableHead>
            <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.views.filters")}</TableHead>
            <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.views.sidebar")}</TableHead>
            <TableHead className="w-20 px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {views.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="px-4">
                {renaming?.id === v.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void patch(v, { name: renaming.name }).then((r) => r && setRenaming(null))
                    }}
                  >
                    <Input value={renaming.name} onChange={(e) => setRenaming({ id: v.id, name: e.target.value })} onBlur={() => setRenaming(null)} autoFocus className="h-7" aria-label={t("docs.view.name")} />
                  </form>
                ) : (
                  <Link href={`/app/documents?view=${v.id}`} className="font-medium underline-offset-2 hover:underline">
                    {v.name}
                  </Link>
                )}
              </TableCell>
              <TableCell className="max-w-96 truncate px-4 text-muted-foreground">{describe(v)}</TableCell>
              <TableCell className="px-4">
                <Switch checked={v.showInSidebar} disabled={busy} onCheckedChange={(on) => void patch(v, { showInSidebar: on })} aria-label={`${t("docs.view.sidebar")}: ${v.name}`} />
              </TableCell>
              <TableCell className="px-4">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.edit")}: ${v.name}`} onClick={() => setRenaming({ id: v.id, name: v.name })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${t("docs.labels.delete")}: ${v.name}`} onClick={() => setDeleting(v)}>
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDelete
        open={!!deleting}
        name={deleting?.name ?? ""}
        body={t("docs.views.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => del({ id: deleting!.id as Id<"docSavedViews"> }), { success: t("docs.view.deleted") }).then((r) => {
            if (r) setDeleting(null)
          })
        }
      />
    </div>
  )
}

function ConfirmDelete({ open, name, body, busy, onCancel, onConfirm }: { open: boolean; name: string; body: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useT()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("docs.labels.deleteTitle")} {name && `„${name}“`}
          </DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("docs.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {t("docs.labels.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
