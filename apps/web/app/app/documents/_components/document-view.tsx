"use client"
import type { CustomFieldView, DocumentDetail, DocumentsLabels } from "@digimuza/documents"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ChevronRight, Download, ExternalLink, FileQuestion, Loader2, Plus, RefreshCw, RotateCcw, Signature, Trash2, TriangleAlert, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent, type KeyboardEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { openPdf, pageSizes } from "@/lib/documents/pdf"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { LabelSelect, TagPicker } from "./labels-ui"
import { formatBytes, submissionHref, templateHref, useDocumentsEnabled, useLabels, useSigningVisible } from "./use-documents"

export function DocumentView({ documentId }: { documentId: string }) {
  const { t } = useT()
  const enabled = useDocumentsEnabled()
  const labels = useLabels()
  const detail = useQuery(api.documents.getDocument, enabled ? { documentId } : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("docs.disabled")}</p>
  if (detail === null)
    return (
      <EmptyState
        icon={<FileQuestion />}
        title={t("docs.notFound.title")}
        body={t("docs.notFound.body")}
        action={
          <Button variant="outline" asChild>
            <Link href="/app/documents">{t("docs.back")}</Link>
          </Button>
        }
      />
    )
  if (!detail || !labels)
    return (
      <div className="grid gap-6">
        <Skeleton className="h-8 w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <Skeleton className="h-[70vh] rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  // Keyed by document: a new document starts from its own values.
  return <Loaded key={detail.document.id} detail={detail} labels={labels} />
}

interface Draft {
  title: string
  documentDate: string
  correspondentId: string | null
  typeId: string | null
  tagIds: string[]
  custom: Record<string, unknown>
}

const draftOf = (d: DocumentDetail): Draft => ({
  title: d.document.title,
  documentDate: d.document.documentDate ?? "",
  correspondentId: d.document.correspondentId,
  typeId: d.document.typeId,
  tagIds: d.document.tagIds,
  custom: d.document.custom,
})

function Loaded({ detail, labels }: { detail: DocumentDetail; labels: DocumentsLabels }) {
  const { t, locale } = useT()
  const router = useRouter()
  const canUpdate = useCan(DocumentsPermissions.update)
  const canDelete = useCan(DocumentsPermissions.delete)
  const canTemplates = useCan(DocumentsPermissions.manageTemplates)
  const signing = useSigningVisible()
  const update = useMutation(api.documents.updateDocument)
  const setTrashed = useMutation(api.documents.setDocumentsTrashed)
  const { run, busy } = useAction()
  const doc = detail.document
  const editable = canUpdate && !doc.trashed
  const isPdf = doc.mimeType === "application/pdf"
  const isImage = doc.mimeType.startsWith("image/")

  const [draft, setDraft] = useState<Draft | null>(null)
  const current = draft ?? draftOf(detail)
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(detail))
  const change = (patch: Partial<Draft>) => setDraft({ ...current, ...patch })
  const [signOpen, setSignOpen] = useState(false)

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!draft) return
    const base = draftOf(detail)
    const custom: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(base.custom), ...Object.keys(draft.custom)])) {
      const v = draft.custom[k]
      if (JSON.stringify(v) !== JSON.stringify(base.custom[k])) custom[k] = v === undefined || v === "" ? null : v
    }
    const res = await run(
      () =>
        update({
          documentId: doc.id as Id<"docDocuments">,
          ...(draft.title !== base.title ? { title: draft.title } : {}),
          ...(draft.documentDate !== base.documentDate ? { documentDate: draft.documentDate || null } : {}),
          ...(draft.correspondentId !== base.correspondentId ? { correspondentId: draft.correspondentId as Id<"docCorrespondents"> | null } : {}),
          ...(draft.typeId !== base.typeId ? { typeId: draft.typeId as Id<"docTypes"> | null } : {}),
          ...(JSON.stringify(draft.tagIds) !== JSON.stringify(base.tagIds) ? { tagIds: draft.tagIds as Id<"docTags">[] } : {}),
          ...(Object.keys(custom).length ? { custom } : {}),
        }),
      { success: t("docs.saved") },
    )
    if (res) setDraft(null)
  }

  const date = (ms: number) => new Intl.DateTimeFormat(locale === "lt" ? "lt-LT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(ms)

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Link href="/app/documents" className="hover:text-foreground">
              {t("docs.back")}
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <span className="tabular-nums">#{doc.asn}</span>
          </nav>
          <h1 className="text-xl font-semibold tracking-tight text-balance">{doc.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.fileUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={detail.fileUrl} download={doc.fileName}>
                <Download />
                {t("docs.download")}
              </a>
            </Button>
          )}
          {signing && canTemplates && isPdf && !doc.trashed && (
            <Button variant="outline" size="sm" onClick={() => setSignOpen(true)}>
              <Signature />
              {t("docs.sendForSigning")}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => setTrashed({ documentIds: [doc.id as Id<"docDocuments">], trashed: !doc.trashed }), { success: doc.trashed ? t("docs.bulk.restored") : t("docs.bulk.trashed") })}
            >
              {doc.trashed ? <RotateCcw /> : <Trash2 />}
              {doc.trashed ? t("docs.restore") : t("docs.trash")}
            </Button>
          )}
        </div>
      </header>

      {doc.trashed && (
        <Alert>
          <Trash2 />
          <AlertDescription>{t("docs.inTrash")}</AlertDescription>
        </Alert>
      )}
      {detail.submissionId && (
        <Alert>
          <Signature />
          <AlertDescription className="flex flex-wrap items-center gap-x-3">
            {t("docs.fromSigning")}
            <Link href={submissionHref(detail.submissionId)} className="font-medium text-foreground underline underline-offset-2">
              {t("docs.openSubmission")}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <section aria-label={doc.fileName} className="overflow-hidden rounded-xl border bg-muted lg:sticky lg:top-6">
          {detail.fileUrl && isPdf ? (
            <iframe src={detail.fileUrl} title={doc.title} className="h-[78vh] w-full bg-background" />
          ) : detail.fileUrl && isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
            <img src={detail.fileUrl} alt={doc.title} className="max-h-[78vh] w-full object-contain" />
          ) : (
            <div className="grid h-80 place-items-center p-6 text-center text-sm text-muted-foreground">
              <div className="grid justify-items-center gap-3">
                <FileQuestion className="size-8" aria-hidden />
                <p className="max-w-[40ch]">{t("docs.noPreview")}</p>
                {detail.fileUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.fileUrl} target="_blank" rel="noreferrer">
                      <ExternalLink />
                      {t("docs.openFile")}
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        <Tabs defaultValue="details" className="min-w-0">
          <TabsList className="w-full">
            <TabsTrigger value="details">{t("docs.tab.details")}</TabsTrigger>
            <TabsTrigger value="content">{t("docs.tab.content")}</TabsTrigger>
            <TabsTrigger value="notes">
              {t("docs.tab.notes")}
              {detail.notes.length > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">
                  {detail.notes.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="info">{t("docs.tab.info")}</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="pt-3">
            {doc.processing !== "done" && (
              <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                {doc.processing === "queued" ? <Loader2 className="size-4 animate-spin" /> : <TriangleAlert className="size-4 text-destructive" />}
                {t(`docs.processing.${doc.processing}` as MessageKey)}
              </p>
            )}
            <form onSubmit={(e) => void save(e)}>
              <fieldset disabled={!editable} className="grid gap-5">
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="doc-title">{t("docs.field.title")}</FieldLabel>
                    <Input id="doc-title" value={current.title} onChange={(e) => change({ title: e.target.value })} maxLength={200} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="doc-date">{t("docs.field.date")}</FieldLabel>
                    <Input id="doc-date" type="date" value={current.documentDate} onChange={(e) => change({ documentDate: e.target.value })} className="w-44" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="doc-correspondent">{t("docs.field.correspondent")}</FieldLabel>
                    <LabelSelect id="doc-correspondent" labels={labels.correspondents} value={current.correspondentId} onChange={(id) => change({ correspondentId: id })} label={t("docs.field.correspondent")} noneLabel={t("docs.field.none")} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="doc-type">{t("docs.field.type")}</FieldLabel>
                    <LabelSelect id="doc-type" labels={labels.types} value={current.typeId} onChange={(id) => change({ typeId: id })} label={t("docs.field.type")} noneLabel={t("docs.field.none")} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("docs.field.tags")}</FieldLabel>
                    <TagPicker tags={labels.tags} value={current.tagIds} onChange={(tagIds) => change({ tagIds })} label={t("docs.field.tags")} size="default" className="w-full" />
                  </Field>
                </FieldGroup>

                <CustomFields fields={labels.customFields} values={current.custom} onChange={(custom) => change({ custom })} editable={editable} />

                {editable && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button type="submit" disabled={!dirty || busy}>
                      {t("docs.save")}
                    </Button>
                    {dirty && (
                      <>
                        <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                          {t("docs.discard")}
                        </Button>
                        <span className="text-sm text-muted-foreground">{t("docs.unsaved")}</span>
                      </>
                    )}
                  </div>
                )}
              </fieldset>
            </form>
          </TabsContent>

          <TabsContent value="content" className="pt-3">
            <ContentTab key={detail.content.length} documentId={doc.id} content={detail.content} editable={editable} />
          </TabsContent>

          <TabsContent value="notes" className="pt-3">
            <Notes documentId={doc.id} notes={detail.notes} canAdd={canUpdate} canDeleteAny={canDelete} date={date} />
          </TabsContent>

          <TabsContent value="info" className="pt-3">
            <InfoTab detail={detail} date={date} canReprocess={editable} />
          </TabsContent>
        </Tabs>
      </div>

      {signOpen && detail.fileUrl && <SendForSigningDialog documentId={doc.id} fileUrl={detail.fileUrl} defaultName={doc.title} onClose={() => setSignOpen(false)} onCreated={(id) => router.push(templateHref(id))} />}
    </div>
  )
}

function CustomFields({ fields, values, onChange, editable }: { fields: CustomFieldView[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; editable: boolean }) {
  const { t } = useT()
  const shown = fields.filter((f) => f.id in values)
  const addable = fields.filter((f) => !(f.id in values))
  if (fields.length === 0) return null
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v })
  const remove = (id: string) => onChange(Object.fromEntries(Object.entries(values).filter(([k]) => k !== id)))
  const initial = (f: CustomFieldView): unknown => (f.type === "boolean" ? false : f.type === "select" ? (f.options[0] ?? "") : "")
  return (
    <section className="grid gap-3" aria-labelledby="doc-custom">
      <div className="flex items-center justify-between gap-2">
        <h2 id="doc-custom" className="text-sm font-medium">
          {t("docs.field.custom")}
        </h2>
        {editable && addable.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Plus />
                {t("docs.field.addCustom")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {addable.map((f) => (
                <DropdownMenuItem key={f.id} onSelect={() => set(f.id, initial(f))}>
                  {f.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {shown.length > 0 && (
        <FieldGroup className="gap-3">
          {shown.map((f) => (
            <Field key={f.id}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor={`cf-${f.id}`}>{f.name}</FieldLabel>
                {editable && (
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`${t("docs.field.removeCustom")}: ${f.name}`} onClick={() => remove(f.id)}>
                    <X />
                  </Button>
                )}
              </div>
              <CustomInput field={f} value={values[f.id]} onChange={(v) => set(f.id, v)} />
            </Field>
          ))}
        </FieldGroup>
      )}
    </section>
  )
}

function CustomInput({ field, value, onChange }: { field: CustomFieldView; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useT()
  const id = `cf-${field.id}`
  switch (field.type) {
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Switch id={id} checked={value === true} onCheckedChange={onChange} />
          <span className="text-sm text-muted-foreground">{value === true ? t("docs.field.yes") : t("docs.field.no")}</span>
        </div>
      )
    case "select":
      return (
        <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case "number":
    case "monetary":
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={field.type === "monetary" ? "0.01" : "any"}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-48 tabular-nums"
        />
      )
    case "date":
      return <Input id={id} type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="w-44" />
    case "url":
      return <Input id={id} type="url" placeholder="https://" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
    default:
      return <Input id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} maxLength={2000} />
  }
}

function ContentTab({ documentId, content, editable }: { documentId: string; content: string; editable: boolean }) {
  const { t } = useT()
  const update = useMutation(api.documents.updateDocument)
  const { run, busy } = useAction()
  const [text, setText] = useState(content)
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{content ? t("docs.content.lead") : t("docs.content.empty")}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} className="min-h-[50vh] font-mono text-xs leading-relaxed" aria-label={t("docs.tab.content")} />
      {editable && (
        <div>
          <Button disabled={busy || text === content} onClick={() => void run(() => update({ documentId: documentId as Id<"docDocuments">, content: text }), { success: t("docs.saved") })}>
            {t("docs.content.save")}
          </Button>
        </div>
      )}
    </div>
  )
}

function Notes({ documentId, notes, canAdd, canDeleteAny, date }: { documentId: string; notes: DocumentDetail["notes"]; canAdd: boolean; canDeleteAny: boolean; date: (ms: number) => string }) {
  const { t } = useT()
  const add = useMutation(api.documents.addNote)
  const del = useMutation(api.documents.deleteNote)
  const { run, busy } = useAction()
  const [body, setBody] = useState("")
  const submit = async () => {
    if (!body.trim()) return
    const res = await run(() => add({ documentId: documentId as Id<"docDocuments">, body }), { success: t("docs.notes.added") })
    if (res) setBody("")
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit()
  }
  return (
    <div className="grid gap-4">
      {canAdd && (
        <div className="grid gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} placeholder={t("docs.notes.placeholder")} aria-label={t("docs.notes.add")} rows={3} />
          <div>
            <Button size="sm" disabled={busy || !body.trim()} onClick={() => void submit()}>
              {t("docs.notes.add")}
            </Button>
          </div>
        </div>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("docs.notes.empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{n.authorName}</span> · {date(n.createdAt)}
                </span>
                {(n.mine || canDeleteAny) && canAdd && (
                  <Button variant="ghost" size="icon-xs" aria-label={t("docs.notes.delete")} disabled={busy} onClick={() => void run(() => del({ noteId: n.id as Id<"docNotes"> }))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InfoTab({ detail, date, canReprocess }: { detail: DocumentDetail; date: (ms: number) => string; canReprocess: boolean }) {
  const { t } = useT()
  const reprocess = useMutation(api.documents.reprocessDocument)
  const { run, busy } = useAction()
  const d = detail.document
  const rows: [string, React.ReactNode][] = [
    [t("docs.info.asn"), <span className="tabular-nums">#{d.asn}</span>],
    [t("docs.info.file"), <span className="break-all">{d.fileName}</span>],
    [t("docs.info.size"), <span className="tabular-nums">{formatBytes(d.size)}</span>],
    ...(d.pageCount ? ([[t("docs.info.pages"), <span className="tabular-nums">{d.pageCount}</span>]] as [string, React.ReactNode][]) : []),
    [t("docs.info.added"), date(d.addedAt)],
    [t("docs.info.updated"), date(d.updatedAt)],
    [t("docs.info.source"), t(`docs.info.source.${d.contentSource}` as MessageKey)],
    [t("docs.info.sha"), <code className="font-mono text-xs break-all">{detail.sha256}</code>],
  ]
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {detail.processingError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>
            {t("docs.info.error")}: {detail.processingError}
          </AlertDescription>
        </Alert>
      )}
      {canReprocess && (
        <div>
          <Button variant="outline" size="sm" disabled={busy || d.processing === "queued"} onClick={() => void run(() => reprocess({ documentId: d.id as Id<"docDocuments"> }), { success: t("docs.reprocessed") })}>
            <RefreshCw />
            {t("docs.reprocess")}
          </Button>
        </div>
      )}
    </div>
  )
}

function SendForSigningDialog({ documentId, fileUrl, defaultName, onClose, onCreated }: { documentId: string; fileUrl: string; defaultName: string; onClose: () => void; onCreated: (templateId: string) => void }) {
  const { t } = useT()
  const create = useMutation(api.documents.createTemplate)
  const { run, busy } = useAction()
  const [name, setName] = useState(defaultName)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(false)
    setReading(true)
    let pages: { width: number; height: number }[]
    try {
      const pdf = await openPdf(fileUrl)
      pages = await pageSizes(pdf)
      await pdf.cleanup()
    } catch {
      setError(true)
      setReading(false)
      return
    }
    setReading(false)
    const res = await run(() => create({ name, documentId: documentId as Id<"docDocuments">, pages }))
    if (res) onCreated(res.templateId)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("docs.sign.title")}</DialogTitle>
            <DialogDescription>{t("docs.sign.body")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="tpl-name">{t("docs.sign.name")}</FieldLabel>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
            {error && <FieldDescription className="text-destructive">{t("docs.sign.failed")}</FieldDescription>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("docs.cancel")}
            </Button>
            <Button type="submit" disabled={busy || reading || !name.trim()}>
              {(busy || reading) && <Loader2 className="animate-spin" />}
              {t("docs.sign.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

