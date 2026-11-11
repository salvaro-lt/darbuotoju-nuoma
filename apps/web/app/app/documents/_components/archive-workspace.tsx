"use client"
import type { DocumentsLabels, DocumentView, ViewFilters } from "@digimuza/documents"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowDownUp,
  CalendarRange,
  FileImage,
  FileText,
  File as FileIcon,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Table2,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useDeferredValue, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { LabelSelect, TagChips, TagPicker } from "./labels-ui"
import { UploadPanel, useUploader } from "./uploader"
import { documentHref, useDocumentsEnabled, useLabels } from "./use-documents"

type Sort = "added" | "date" | "title" | "asn" | "relevance"
const SORTS: Sort[] = ["added", "date", "title", "asn"]

/** Filters live in the URL: links to a filtered list can be shared. */
function filtersFrom(p: URLSearchParams): ViewFilters {
  const f: ViewFilters = {}
  const tags = p.get("tags")?.split(",").filter(Boolean)
  if (tags?.length) f.tagIds = tags
  if (p.get("mode") === "any") f.tagMode = "any"
  if (p.get("untagged") === "1") f.withoutTags = true
  const c = p.get("c")
  if (c) f.correspondentId = c
  const ty = p.get("type")
  if (ty) f.typeId = ty
  const from = p.get("from")
  if (from) f.from = from
  const to = p.get("to")
  if (to) f.to = to
  return f
}

function toParams(base: URLSearchParams, f: ViewFilters): URLSearchParams {
  const q = new URLSearchParams(base)
  for (const k of ["tags", "mode", "untagged", "c", "type", "from", "to"]) q.delete(k)
  if (f.tagIds?.length) q.set("tags", f.tagIds.join(","))
  if (f.tagMode === "any") q.set("mode", "any")
  if (f.withoutTags) q.set("untagged", "1")
  if (f.correspondentId) q.set("c", f.correspondentId)
  if (f.typeId) q.set("type", f.typeId)
  if (f.from) q.set("from", f.from)
  if (f.to) q.set("to", f.to)
  return q
}

const sameFilters = (a: ViewFilters, b: ViewFilters) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
const normalize = (f: ViewFilters) => ({ ...f, tagIds: f.tagIds ? [...f.tagIds].sort() : undefined, search: f.search || undefined })

export function ArchiveWorkspace() {
  const { t } = useT()
  const enabled = useDocumentsEnabled()
  const labels = useLabels()
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("docs.disabled")}</p>
  if (!labels)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <GridSkeleton />
      </div>
    )
  return <Workspace labels={labels} />
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
      ))}
    </div>
  )
}

function Workspace({ labels }: { labels: DocumentsLabels }) {
  const { t } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const canCreate = useCan(DocumentsPermissions.create)
  const canUpdate = useCan(DocumentsPermissions.update)
  const canDelete = useCan(DocumentsPermissions.delete)
  const canLabels = useCan(DocumentsPermissions.manageLabels)

  const filters = filtersFrom(params)
  const trash = params.get("trash") === "1"
  const layout = params.get("layout") === "table" ? "table" : "grid"
  const view = labels.views.find((v) => v.id === params.get("view")) ?? null
  const [searchText, setSearchText] = useState(params.get("q") ?? "")
  const search = useDeferredValue(searchText.trim())
  const sortParam = params.get("sort") as Sort | null
  const sort: Sort = sortParam && SORTS.includes(sortParam) ? sortParam : search ? "relevance" : "added"
  const direction = params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : undefined

  const replace = (q: URLSearchParams) => router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false })
  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(params)
    if (v === null) q.delete(k)
    else q.set(k, v)
    replace(q)
  }
  const setFilters = (f: ViewFilters) => replace(toParams(params, f))

  // The search box writes to the URL after typing settles.
  useEffect(() => {
    const current = params.get("q") ?? ""
    if (search === current) return
    const q = new URLSearchParams(params)
    if (search) q.set("q", search)
    else q.delete("q")
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [search, params, pathname, router])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const result = useQuery(api.documents.listDocuments, {
    filters: { ...filters, ...(search ? { search } : {}) },
    trashed: trash,
    sort,
    ...(direction ? { direction } : {}),
    limit: 300,
  })

  const uploader = useUploader()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const canDrop = canCreate && !trash
  const onDrag = (e: DragEvent, kind: "enter" | "leave" | "over" | "drop") => {
    if (!canDrop || !e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    if (kind === "enter") dragDepth.current++
    if (kind === "leave") dragDepth.current--
    if (kind === "drop") {
      dragDepth.current = 0
      const files = [...e.dataTransfer.files]
      if (files.length) void uploader.upload(files)
    }
    setDragging(dragDepth.current > 0 && kind !== "drop")
  }

  const selectView = (id: string) => {
    setSelected(new Set())
    if (id === "all") return replace(new URLSearchParams(trash ? { trash: "1" } : {}))
    const v = labels.views.find((x) => x.id === id)
    if (!v) return
    const q = toParams(new URLSearchParams({ view: id }), v.filters)
    if (v.filters.search) q.set("q", v.filters.search)
    setSearchText(v.filters.search ?? "")
    replace(q)
  }

  const currentFilters: ViewFilters = { ...filters, ...(search ? { search } : {}) }
  const viewDirty = view ? !sameFilters(view.filters, currentFilters) : false
  const anyFilter = Object.keys(currentFilters).length > 0
  const [saveOpen, setSaveOpen] = useState(false)
  const saveView = useMutation(api.documents.saveView)
  const deleteView = useMutation(api.documents.deleteView)
  const { run, busy } = useAction()

  const clearAll = () => {
    setSearchText("")
    replace(new URLSearchParams(trash ? { trash: "1" } : {}))
  }

  const docs = result?.documents
  const ids = docs?.map((d) => d.id) ?? []
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const selectable = trash ? canDelete : canUpdate || canDelete

  return (
    <div className="relative flex min-w-0 flex-col gap-4" onDragEnter={(e) => onDrag(e, "enter")} onDragLeave={(e) => onDrag(e, "leave")} onDragOver={(e) => onDrag(e, "over")} onDrop={(e) => onDrag(e, "drop")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{trash ? t("docs.trashTitle") : (view?.name ?? t("docs.title"))}</h1>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("docs.total")}: {result ? result.total : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && (
            <Button variant={trash ? "secondary" : "ghost"} size="sm" aria-pressed={trash} onClick={() => (setSelected(new Set()), setParam("trash", trash ? null : "1"))}>
              <Trash2 />
              <span className="hidden sm:inline">{t("docs.showTrash")}</span>
            </Button>
          )}
          {canCreate && !trash && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ""
                  if (files.length) void uploader.upload(files)
                }}
              />
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload />
                {t("docs.upload")}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {!trash && labels.views.length > 0 && (
          <Tabs value={view?.id ?? "all"} onValueChange={selectView} className="min-w-0">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="all">{t("docs.allDocuments")}</TabsTrigger>
              {labels.views.map((v) => (
                <TabsTrigger key={v.id} value={v.id}>
                  {v.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={t("docs.search")} aria-label={t("docs.search")} className="h-7 w-52 pl-8 sm:w-72" />
        </div>
        <TagPicker
          tags={labels.tags}
          value={filters.tagIds ?? []}
          onChange={(tagIds) => setFilters({ ...filters, tagIds, withoutTags: undefined })}
          label={t("docs.filter.tags")}
          footer={
            <div className="grid gap-2 text-sm">
              <Tabs value={filters.tagMode ?? "all"} onValueChange={(m) => setFilters({ ...filters, tagMode: m === "any" ? "any" : undefined })}>
                <TabsList className="w-full">
                  <TabsTrigger value="all">{t("docs.filter.tagsAll")}</TabsTrigger>
                  <TabsTrigger value="any">{t("docs.filter.tagsAny")}</TabsTrigger>
                </TabsList>
              </Tabs>
              <label className="flex items-center gap-2 px-1">
                <Checkbox checked={!!filters.withoutTags} onCheckedChange={(v) => setFilters({ ...filters, withoutTags: v === true || undefined, tagIds: v === true ? undefined : filters.tagIds })} />
                {t("docs.filter.withoutTags")}
              </label>
            </div>
          }
        />
        <LabelSelect
          labels={labels.correspondents}
          value={filters.correspondentId ?? null}
          onChange={(id) => setFilters({ ...filters, correspondentId: id ?? undefined })}
          label={t("docs.filter.correspondent")}
          noneLabel={`${t("docs.filter.correspondent")}: ${t("docs.filter.any").toLowerCase()}`}
          size="sm"
          className="w-auto max-w-52"
        />
        <LabelSelect
          labels={labels.types}
          value={filters.typeId ?? null}
          onChange={(id) => setFilters({ ...filters, typeId: id ?? undefined })}
          label={t("docs.filter.type")}
          noneLabel={`${t("docs.filter.type")}: ${t("docs.filter.any").toLowerCase()}`}
          size="sm"
          className="w-auto max-w-52"
        />
        <DateFilter filters={filters} onChange={setFilters} />
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X />
            {t("docs.clearFilters")}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {canLabels && !trash && anyFilter && (!view || viewDirty) && (
            <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
              <Plus />
              {t("docs.view.save")}
            </Button>
          )}
          {canLabels && view && !trash && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={view.name}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {viewDirty && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => void run(() => saveView({ id: view.id as Id<"docSavedViews">, name: view.name, filters: currentFilters, showInSidebar: view.showInSidebar }), { success: t("docs.view.saved") })}
                  >
                    <PenLine />
                    {t("docs.view.update")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    void run(() => deleteView({ id: view.id as Id<"docSavedViews"> }), { success: t("docs.view.deleted") }).then((r) => {
                      if (r) selectView("all")
                    })
                  }
                >
                  <Trash2 />
                  {t("docs.view.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <SortMenu sort={sort} direction={direction} searching={!!search} onChange={(s, d) => replace(withSort(params, s, d))} />
          <Tabs value={layout} onValueChange={(v) => setParam("layout", v === "table" ? "table" : null)}>
            <TabsList>
              <TabsTrigger value="grid" aria-label={t("docs.layout.grid")} title={t("docs.layout.grid")}>
                <LayoutGrid className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="table" aria-label={t("docs.layout.table")} title={t("docs.layout.table")}>
                <Table2 className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {selected.size > 0 && selectable && <BulkBar labels={labels} ids={[...selected]} trash={trash} onDone={() => setSelected(new Set())} />}

      {result?.truncated && <p className="text-xs text-muted-foreground">{t("docs.truncated")}</p>}

      {!docs ? (
        layout === "grid" ? <GridSkeleton /> : <Skeleton className="h-80 w-full rounded-xl" />
      ) : docs.length === 0 ? (
        trash ? (
          <EmptyState icon={<Trash2 />} title={t("docs.trashEmpty.title")} body={t("docs.trashEmpty.body")} />
        ) : anyFilter ? (
          <EmptyState icon={<Search />} title={t("docs.noMatch.title")} body={t("docs.noMatch.body")} action={<Button variant="outline" onClick={clearAll}>{t("docs.clearFilters")}</Button>} />
        ) : (
          <EmptyState
            icon={<FileText />}
            title={t("docs.empty.title")}
            body={canCreate ? t("docs.empty.body") : t("docs.empty.reader")}
            action={
              canCreate ? (
                <Button onClick={() => fileInput.current?.click()}>
                  <Upload />
                  {t("docs.upload")}
                </Button>
              ) : undefined
            }
          />
        )
      ) : layout === "grid" ? (
        <DocumentGrid docs={docs} labels={labels} selected={selectable ? selected : null} onToggle={toggle} />
      ) : (
        <DocumentTable docs={docs} labels={labels} selected={selectable ? selected : null} allOn={allOn} onToggle={toggle} onAll={(on) => setSelected(on ? new Set(ids) : new Set())} />
      )}

      {dragging && (
        <div className="pointer-events-none absolute -inset-2 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/85">
          <div className="grid justify-items-center gap-2 text-center">
            <Upload className="size-8 text-primary" aria-hidden />
            <p className="text-base font-medium">{t("docs.dropHere")}</p>
            <p className="max-w-[40ch] text-sm text-muted-foreground">{t("docs.dropHint")}</p>
          </div>
        </div>
      )}

      <UploadPanel items={uploader.items} busy={uploader.busy} onClose={uploader.clear} />

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={async (name, showInSidebar) => {
          const res = await run(() => saveView({ name, filters: currentFilters, showInSidebar }), { success: t("docs.view.saved") })
          if (res) {
            setSaveOpen(false)
            const q = toParams(new URLSearchParams({ view: res.id }), currentFilters)
            if (search) q.set("q", search)
            replace(q)
          }
        }}
        busy={busy}
      />
    </div>
  )
}

function withSort(params: URLSearchParams, s: Sort, d: "asc" | "desc") {
  const q = new URLSearchParams(params)
  q.set("sort", s)
  q.set("dir", d)
  return q
}

function SortMenu({ sort, direction, searching, onChange }: { sort: Sort; direction: "asc" | "desc" | undefined; searching: boolean; onChange: (s: Sort, d: "asc" | "desc") => void }) {
  const { t } = useT()
  const dir = direction ?? (sort === "title" ? "asc" : "desc")
  const options: Sort[] = searching ? ["relevance", ...SORTS] : SORTS
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("docs.sort")}>
          <ArrowDownUp />
          <span className="hidden lg:inline">{t(`docs.sort.${sort}` as MessageKey)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t("docs.sort")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onChange(v as Sort, v === "title" ? "asc" : "desc")}>
          {options.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {t(`docs.sort.${s}` as MessageKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {sort !== "relevance" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={dir} onValueChange={(v) => onChange(sort, v === "asc" ? "asc" : "desc")}>
              <DropdownMenuRadioItem value="asc">{t("docs.sort.asc")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">{t("docs.sort.desc")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DateFilter({ filters, onChange }: { filters: ViewFilters; onChange: (f: ViewFilters) => void }) {
  const { t } = useT()
  const on = !!(filters.from || filters.to)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("docs.filter.date")}>
          <CalendarRange />
          <span className="tabular-nums">{on ? `${filters.from ?? "…"} – ${filters.to ?? "…"}` : t("docs.filter.date")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="docs-from">{t("docs.filter.from")}</FieldLabel>
            <Input id="docs-from" type="date" value={filters.from ?? ""} onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="docs-to">{t("docs.filter.to")}</FieldLabel>
            <Input id="docs-to" type="date" value={filters.to ?? ""} onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}

function fileIcon(d: DocumentView) {
  if (d.mimeType === "application/pdf") return FileText
  if (d.mimeType.startsWith("image/")) return FileImage
  return FileIcon
}

function StatusLine({ d }: { d: DocumentView }) {
  const { t } = useT()
  if (d.processing === "queued")
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" />
        {t("docs.processing.queued")}
      </Badge>
    )
  if (d.processing === "failed")
    return (
      <Badge variant="destructive">
        <TriangleAlert />
        {t("docs.processing.failed")}
      </Badge>
    )
  if (d.fromSigning) return <Badge variant="outline">{t("docs.signed")}</Badge>
  return null
}

function DocumentGrid({ docs, labels, selected, onToggle }: { docs: DocumentView[]; labels: DocumentsLabels; selected: Set<string> | null; onToggle: (id: string) => void }) {
  const { t, locale } = useT()
  const name = (id: string | null, from: { id: string; name: string }[]) => (id ? from.find((x) => x.id === id)?.name : undefined)
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {docs.map((d) => {
        const Icon = fileIcon(d)
        const on = selected?.has(d.id) ?? false
        const correspondent = name(d.correspondentId, labels.correspondents)
        return (
          <li key={d.id} className={cn("group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring/50", on && "ring-2 ring-primary")}>
            <Link href={documentHref(d.id)} className="flex flex-1 flex-col outline-none" aria-label={d.title}>
              <div className="relative aspect-[4/3] overflow-hidden border-b bg-muted">
                {d.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL, already sized
                  <img src={d.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover object-top" />
                ) : (
                  <div className="grid size-full place-items-center text-muted-foreground">
                    <Icon className="size-10" strokeWidth={1.25} aria-hidden />
                  </div>
                )}
                <span className="absolute right-2 bottom-2 rounded-md bg-background/90 px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground tabular-nums">#{d.asn}</span>
              </div>
              <div className="grid flex-1 content-start gap-1.5 p-3">
                <p className="line-clamp-2 text-sm leading-snug font-medium">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[correspondent, d.documentDate ? formatDate(Date.parse(`${d.documentDate}T00:00:00Z`), locale) : t("docs.noDate")].filter(Boolean).join(" · ")}
                </p>
                <TagChips ids={d.tagIds} tags={labels.tags} max={3} />
                <StatusLine d={d} />
              </div>
            </Link>
            {selected && (
              <div className={cn("absolute top-2 left-2 rounded-md bg-background/90 p-1 transition-opacity", on ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                <Checkbox checked={on} onCheckedChange={() => onToggle(d.id)} aria-label={`${t("docs.select")}: ${d.title}`} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function DocumentTable({
  docs,
  labels,
  selected,
  allOn,
  onToggle,
  onAll,
}: {
  docs: DocumentView[]
  labels: DocumentsLabels
  selected: Set<string> | null
  allOn: boolean
  onToggle: (id: string) => void
  onAll: (on: boolean) => void
}) {
  const { t, locale } = useT()
  const router = useRouter()
  const name = (id: string | null, from: { id: string; name: string }[]) => (id ? (from.find((x) => x.id === id)?.name ?? "") : "")
  return (
    <div className="overflow-x-auto rounded-xl border bg-card" role="region" aria-label={t("docs.title")}>
      <Table className="min-w-max">
        <TableHeader className="sticky top-0 z-10 bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {selected && (
              <TableHead className="w-10 px-3">
                <Checkbox aria-label={t("docs.selectAll")} checked={allOn} onCheckedChange={(v) => onAll(v === true)} />
              </TableHead>
            )}
            <TableHead className="h-10 w-16 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.asn")}</TableHead>
            <TableHead className="h-10 min-w-72 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.title")}</TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.correspondent")}</TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.type")}</TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.tags")}</TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.date")}</TableHead>
            <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("docs.col.added")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => {
            const Icon = fileIcon(d)
            return (
              <TableRow key={d.id} data-state={selected?.has(d.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => router.push(documentHref(d.id))}>
                {selected && (
                  <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => onToggle(d.id)} aria-label={`${t("docs.select")}: ${d.title}`} />
                  </TableCell>
                )}
                <TableCell className="px-4 text-muted-foreground tabular-nums">#{d.asn}</TableCell>
                <TableCell className="px-4">
                  <Link href={documentHref(d.id)} className="flex items-center gap-2 font-medium underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="max-w-[36ch] truncate">{d.title}</span>
                  </Link>
                  {(d.processing !== "done" || d.fromSigning) && (
                    <div className="mt-1">
                      <StatusLine d={d} />
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-4">{name(d.correspondentId, labels.correspondents)}</TableCell>
                <TableCell className="px-4">{name(d.typeId, labels.types)}</TableCell>
                <TableCell className="px-4">
                  <TagChips ids={d.tagIds} tags={labels.tags} max={3} />
                </TableCell>
                <TableCell className="px-4 tabular-nums">{d.documentDate ? formatDate(Date.parse(`${d.documentDate}T00:00:00Z`), locale) : ""}</TableCell>
                <TableCell className="px-4 text-muted-foreground tabular-nums">{formatDate(d.addedAt, locale)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function BulkBar({ labels, ids, trash, onDone }: { labels: DocumentsLabels; ids: string[]; trash: boolean; onDone: () => void }) {
  const { t } = useT()
  const canUpdate = useCan(DocumentsPermissions.update)
  const canDelete = useCan(DocumentsPermissions.delete)
  const bulk = useMutation(api.documents.bulkEditDocuments)
  const setTrashed = useMutation(api.documents.setDocumentsTrashed)
  const remove = useMutation(api.documents.deleteDocuments)
  const { run, busy } = useAction()
  const [confirm, setConfirm] = useState(false)
  const documentIds = ids as Id<"docDocuments">[]
  const edit = async (patch: Omit<Parameters<typeof bulk>[0], "documentIds">) => {
    const r = await run(() => bulk({ documentIds, ...patch }), { success: t("docs.bulk.done") })
    if (r) onDone()
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" role="status">
      <span className="text-muted-foreground tabular-nums">
        {t("docs.selected")}: {ids.length}
      </span>
      {!trash && canUpdate && (
        <>
          <LabelMenu label={t("docs.bulk.addTag")} items={labels.tags} onPick={(id) => void edit({ addTagIds: [id as Id<"docTags">] })} disabled={busy} />
          <LabelMenu label={t("docs.bulk.removeTag")} items={labels.tags} onPick={(id) => void edit({ removeTagIds: [id as Id<"docTags">] })} disabled={busy} />
          <LabelMenu label={t("docs.bulk.correspondent")} items={labels.correspondents} onPick={(id) => void edit({ correspondentId: id as Id<"docCorrespondents"> | null })} clearable disabled={busy} />
          <LabelMenu label={t("docs.bulk.type")} items={labels.types} onPick={(id) => void edit({ typeId: id as Id<"docTypes"> | null })} clearable disabled={busy} />
        </>
      )}
      {canDelete && !trash && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setTrashed({ documentIds, trashed: true }), { success: t("docs.bulk.trashed") }).then((r) => r && onDone())}>
          <Trash2 />
          {t("docs.bulk.trash")}
        </Button>
      )}
      {canDelete && trash && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setTrashed({ documentIds, trashed: false }), { success: t("docs.bulk.restored") }).then((r) => r && onDone())}>
            <RotateCcw />
            {t("docs.bulk.restore")}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>
            <Trash2 />
            {t("docs.bulk.deleteForever")}
          </Button>
        </>
      )}
      <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={t("docs.clearSelection")} onClick={onDone}>
        <X />
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("docs.confirmDelete.title")}</DialogTitle>
            <DialogDescription>{t("docs.confirmDelete.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("docs.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(() => remove({ documentIds }), { success: t("docs.bulk.deleted") }).then((r) => {
                  if (r) {
                    setConfirm(false)
                    onDone()
                  }
                })
              }
            >
              {t("docs.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LabelMenu({ label, items, onPick, clearable, disabled }: { label: string; items: { id: string; name: string; color?: string }[]; onPick: (id: string | null) => void; clearable?: boolean; disabled?: boolean }) {
  const { t } = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled || (items.length === 0 && !clearable)}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {items.map((x) => (
          <DropdownMenuItem key={x.id} onSelect={() => onPick(x.id)}>
            {x.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: x.color }} aria-hidden />}
            <span className="truncate">{x.name}</span>
          </DropdownMenuItem>
        ))}
        {clearable && (
          <>
            {items.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onPick(null)}>
              <X />
              {t("docs.bulk.clear")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SaveViewDialog({ open, onOpenChange, onSave, busy }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (name: string, sidebar: boolean) => Promise<void>; busy: boolean }) {
  const { t } = useT()
  const [name, setName] = useState("")
  const [sidebar, setSidebar] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) void onSave(name.trim(), sidebar).then(() => setName(""))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("docs.view.saveTitle")}</DialogTitle>
            <DialogDescription>{t("docs.view.saveBody")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="view-name">{t("docs.view.name")}</FieldLabel>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
            </Field>
            <div className="flex items-center gap-2">
              <Switch id="view-sidebar" checked={sidebar} onCheckedChange={setSidebar} />
              <Label htmlFor="view-sidebar">{t("docs.view.sidebar")}</Label>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("docs.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {t("docs.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
