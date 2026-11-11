"use client"
import type { CrmObjectView, CrmViewView } from "@digimuza/crm"
import type { ViewFilter, ViewSort } from "@digimuza/crm/fields"
import { CrmFlags, CrmPermissions } from "@digimuza/crm/manifest"
import { useCan, useFeatureFlag } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Archive, ArchiveRestore, Columns3, Kanban, MoreHorizontal, Plus, Search, Table2, Trash2, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useDeferredValue, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { FilterEditor } from "./filter-editor"
import { ObjectIcon } from "./icons"
import { KanbanBoard } from "./kanban-board"
import { RecordFormDialog } from "./record-form-dialog"
import { RecordsTable } from "./records-table"
import { useCrmObject } from "./use-crm"

interface Draft {
  columns: string[]
  sort: ViewSort | null
  filters: ViewFilter[]
}

const draftOf = (v: CrmViewView): Draft => ({ columns: v.columns, sort: v.sort, filters: v.filters })
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

/** One object's records: view tabs, search, filters, sort, columns; table or kanban. */
export function ObjectWorkspace({ objectKey }: { objectKey: string }) {
  const { t } = useT()
  const { enabled, object } = useCrmObject(objectKey)
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crm.disabled")}</p>
  if (object === undefined) return <WorkspaceSkeleton />
  if (object === null) return <EmptyState icon={<Search />} title={t("crm.list.noMatch.title")} body={t("crm.objectMissing")} />
  // Keyed: switching objects starts from that object's own views and drafts.
  return <Workspace key={object.id} object={object} />
}

function WorkspaceSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-8 w-full max-w-md" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  )
}

function Workspace({ object }: { object: CrmObjectView }) {
  const { t } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const canCreate = useCan(CrmPermissions.create)
  const canDelete = useCan(CrmPermissions.delete)
  const canViews = useCan(CrmPermissions.manageViews)
  const kanbanOn = useFeatureFlag(CrmFlags.kanban)

  const views = object.views.filter((v) => v.kind === "table" || kanbanOn)
  const view = views.find((v) => v.id === params.get("view")) ?? views[0] ?? null
  const fallback: Draft = { columns: object.fields.slice(0, 6).map((f) => f.key), sort: null, filters: [] }
  const saved = view ? draftOf(view) : fallback

  // The draft follows the selected view until the user changes something.
  const [draftState, setDraftState] = useState<{ viewId: string | null; draft: Draft } | null>(null)
  const draft = draftState && draftState.viewId === (view?.id ?? null) ? draftState.draft : saved
  const setDraft = (d: Partial<Draft>) => setDraftState({ viewId: view?.id ?? null, draft: { ...draft, ...d } })
  const dirty = !same(draft, saved)

  const [searchText, setSearchText] = useState("")
  const search = useDeferredValue(searchText.trim())
  const [archived, setArchived] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<{ initial: Record<string, unknown> } | null>(null)
  const [newView, setNewView] = useState(false)

  const result = useQuery(api.crm.listRecords, {
    objectKey: object.key,
    filters: draft.filters,
    ...(draft.sort ? { sort: draft.sort } : {}),
    ...(search ? { search } : {}),
    archived,
    limit: 500,
  })

  const updateView = useMutation(api.crm.updateView)
  const deleteView = useMutation(api.crm.deleteView)
  const archive = useMutation(api.crm.setRecordsArchived)
  const { run, busy } = useAction()

  const isKanban = view?.kind === "kanban" && !!view.groupBy && !archived
  const selectView = (id: string) => {
    const q = new URLSearchParams(params)
    q.set("view", id)
    setSelected(new Set())
    router.replace(`${pathname}?${q}`, { scroll: false })
  }

  async function saveView() {
    if (!view) return
    await run(() => updateView({ viewId: view.id as Id<"crmViews">, columns: draft.columns, sort: draft.sort, filters: draft.filters }), { success: t("crm.view.saved") })
  }

  async function removeView() {
    if (!view) return
    const res = await run(() => deleteView({ viewId: view.id as Id<"crmViews"> }), { success: t("crm.view.deleted") })
    if (res) router.replace(pathname, { scroll: false })
  }

  async function setArchivedSelected(next: boolean) {
    const ids = [...selected] as Id<"crmRecords">[]
    const res = await run(() => archive({ recordIds: ids, archived: next }), { success: next ? t("crm.record.archived") : t("crm.record.restored") })
    if (res) setSelected(new Set())
  }

  const filtered = draft.filters.length > 0 || !!search
  const addButton = canCreate && !archived && (
    <Button size="sm" onClick={() => setCreating({ initial: {} })}>
      <Plus />
      {t("crm.add")}
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <ObjectIcon name={object.icon} className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{object.namePlural}</h1>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("crm.total")}: {result ? result.total : "…"}
            </p>
          </div>
        </div>
        {addButton}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {views.length > 0 && (
          <Tabs value={view?.id ?? ""} onValueChange={selectView} className="min-w-0">
            <TabsList className="max-w-full overflow-x-auto">
              {views.map((v) => (
                <TabsTrigger key={v.id} value={v.id} className="gap-1.5">
                  {v.kind === "kanban" ? <Kanban className="size-3.5" /> : <Table2 className="size-3.5" />}
                  {v.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {canViews && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("crm.view.menu")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setNewView(true)}>
                <Plus />
                {t("crm.view.new")}
              </DropdownMenuItem>
              {view && views.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void removeView()}>
                    <Trash2 />
                    {t("crm.view.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={t("crm.search")} aria-label={t("crm.search")} className="h-7 w-44 pl-8 sm:w-56" />
          </div>
          <FilterEditor object={object} filters={draft.filters} onChange={(filters) => setDraft({ filters })} />
          <SortPicker object={object} sort={draft.sort} onChange={(sort) => setDraft({ sort })} />
          <ColumnsPicker object={object} columns={draft.columns} onChange={(columns) => setDraft({ columns })} />
          {canDelete && (
            <Button variant={archived ? "secondary" : "ghost"} size="sm" aria-pressed={archived} onClick={() => {
                setArchived((a) => !a)
                setSelected(new Set())
              }}
            >
              <Archive />
              <span className="hidden sm:inline">{t("crm.showArchived")}</span>
            </Button>
          )}
        </div>
      </div>

      {(dirty || (selected.size > 0 && canDelete)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          {selected.size > 0 && canDelete && (
            <>
              <span className="text-muted-foreground tabular-nums">
                {t("crm.selected")}: {selected.size}
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void setArchivedSelected(!archived)}>
                {archived ? <ArchiveRestore /> : <Archive />}
                {archived ? t("crm.restoreSelected") : t("crm.archiveSelected")}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("crm.clear")} onClick={() => setSelected(new Set())}>
                <X />
              </Button>
            </>
          )}
          {dirty && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground">{t("crm.view.unsaved")}</span>
              <Button size="sm" variant="ghost" onClick={() => setDraftState(null)}>
                {t("crm.view.reset")}
              </Button>
              {canViews && view && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveView()}>
                  {t("crm.view.save")}
                </Button>
              )}
            </span>
          )}
        </div>
      )}

      {result?.truncated && <p className="text-xs text-muted-foreground">{t("crm.truncated")}</p>}

      {result && result.records.length === 0 && !isKanban ? (
        filtered ? (
          <EmptyState
            icon={<Search />}
            title={t("crm.list.noMatch.title")}
            body={t("crm.list.noMatch.body")}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearchText("")
                  setDraft({ filters: [] })
                }}
              >
                {t("crm.clearFilters")}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<ObjectIcon name={object.icon} />} title={t("crm.list.empty.title")} body={archived ? undefined : t("crm.list.empty.body")} action={addButton || undefined} />
        )
      ) : isKanban ? (
        <KanbanBoard object={object} groupBy={view!.groupBy!} columns={draft.columns} result={result} onAdd={(value) => setCreating({ initial: value ? { [view!.groupBy!]: value } : {} })} />
      ) : (
        <RecordsTable object={object} columns={draft.columns} result={result} sort={draft.sort} onSort={(sort) => setDraft({ sort })} selected={canDelete ? selected : null} onSelect={setSelected} />
      )}

      {creating && <RecordFormDialog object={object} open onOpenChange={(v) => !v && setCreating(null)} initial={creating.initial} />}
      {newView && <NewViewDialog object={object} draft={draft} onClose={() => setNewView(false)} onCreated={selectView} />}
    </div>
  )
}

function SortPicker({ object, sort, onChange }: { object: CrmObjectView; sort: ViewSort | null; onChange: (s: ViewSort | null) => void }) {
  const { t } = useT()
  const NONE = "__none__"
  return (
    <div className="flex items-center">
      <Select value={sort?.fieldKey ?? NONE} onValueChange={(k) => onChange(k === NONE ? null : { fieldKey: k, direction: sort?.direction ?? "asc" })}>
        <SelectTrigger size="sm" className={sort ? "rounded-r-none" : undefined} aria-label={t("crm.sort")}>
          <SelectValue placeholder={t("crm.sort")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("crm.sortNone")}</SelectItem>
          {object.fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sort && (
        <Select value={sort.direction} onValueChange={(d) => onChange({ ...sort, direction: d as "asc" | "desc" })}>
          <SelectTrigger size="sm" className="-ml-px rounded-l-none" aria-label={t("crm.sort")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">{t("crm.asc")}</SelectItem>
            <SelectItem value="desc">{t("crm.desc")}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function ColumnsPicker({ object, columns, onChange }: { object: CrmObjectView; columns: string[]; onChange: (c: string[]) => void }) {
  const { t } = useT()
  // Keep the admin's field order; hidden fields drop out, shown ones keep their place.
  const toggle = (key: string, on: boolean) => {
    const next = on ? object.fields.map((f) => f.key).filter((k) => k === key || columns.includes(k)) : columns.filter((k) => k !== key)
    if (next.length > 0) onChange(next)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("crm.columns")}>
          <Columns3 />
          <span className="hidden sm:inline">{t("crm.columns")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
          {object.fields.map((f) => {
            const id = `col-${f.key}`
            return (
              <li key={f.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <Checkbox id={id} checked={columns.includes(f.key)} onCheckedChange={(v) => toggle(f.key, v === true)} />
                <Label htmlFor={id} className="flex-1 truncate font-normal">
                  {f.label}
                </Label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function NewViewDialog({ object, draft, onClose, onCreated }: { object: CrmObjectView; draft: Draft; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useT()
  const kanbanOn = useFeatureFlag(CrmFlags.kanban)
  const create = useMutation(api.crm.createView)
  const { run, busy } = useAction()
  const selects = object.fields.filter((f) => f.type === "select")
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"table" | "kanban">("table")
  const [groupBy, setGroupBy] = useState(selects[0]?.key ?? "")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(
      () =>
        create({
          objectId: object.id as Id<"crmObjects">,
          name,
          kind,
          columns: draft.columns,
          filters: draft.filters,
          ...(draft.sort ? { sort: draft.sort } : {}),
          ...(kind === "kanban" ? { groupBy } : {}),
        }),
      { success: t("crm.view.created") },
    )
    if (!res) return
    onClose()
    onCreated(res.viewId)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("crm.view.new")}</DialogTitle>
            <DialogDescription>{t("crm.view.newLead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="view-name">{t("crm.view.name")}</FieldLabel>
              <Input id="view-name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {kanbanOn && (
              <Field>
                <FieldLabel htmlFor="view-kind">{t("crm.view.kind")}</FieldLabel>
                <Select value={kind} onValueChange={(v) => setKind(v as "table" | "kanban")}>
                  <SelectTrigger id="view-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table">
                      <Table2 />
                      {t("crm.view.table")}
                    </SelectItem>
                    <SelectItem value="kanban" disabled={selects.length === 0}>
                      <Kanban />
                      {t("crm.view.kanban")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {selects.length === 0 && <FieldDescription>{t("crm.view.noGroupField")}</FieldDescription>}
              </Field>
            )}
            {kind === "kanban" && (
              <Field>
                <FieldLabel htmlFor="view-group">{t("crm.view.groupBy")}</FieldLabel>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger id="view-group" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selects.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t("crm.view.groupByHint")}</FieldDescription>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
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
