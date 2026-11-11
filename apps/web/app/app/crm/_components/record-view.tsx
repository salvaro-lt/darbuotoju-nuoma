"use client"
import type { CrmFieldView, CrmObjectView, CrmRecordDetail } from "@digimuza/crm"
import { isEmptyValue } from "@digimuza/crm/fields"
import { CrmPermissions } from "@digimuza/crm/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Archive, ArchiveRestore, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent, type KeyboardEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { FieldValueDisplay } from "./field-display"
import { FieldInput } from "./field-input"
import { ObjectIcon } from "./icons"
import { RecordFormDialog } from "./record-form-dialog"
import { recordHref, useCrmObject } from "./use-crm"

/** Types whose editor commits on change; the rest commit on Enter / blur. */
const INSTANT = new Set(["boolean", "select", "multiSelect", "rating", "relation", "date"])

export function RecordView({ objectKey, recordId }: { objectKey: string; recordId: string }) {
  const { t } = useT()
  const { enabled, objects, object } = useCrmObject(objectKey)
  const detail = useQuery(api.crm.getRecord, enabled && object ? { recordId: recordId as Id<"crmRecords"> } : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crm.disabled")}</p>
  if (object === null) return <EmptyState icon={<Archive />} title={t("crm.list.noMatch.title")} body={t("crm.objectMissing")} />
  if (!object || !objects || detail === undefined)
    return (
      <div className="grid gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  return <Loaded object={object} objects={objects} detail={detail} />
}

function Loaded({ object, objects, detail }: { object: CrmObjectView; objects: CrmObjectView[]; detail: CrmRecordDetail }) {
  const { t, locale } = useT()
  const canUpdate = useCan(CrmPermissions.update)
  const canDelete = useCan(CrmPermissions.delete)
  const archive = useMutation(api.crm.setRecordsArchived)
  const { run, busy } = useAction()
  const { record } = detail
  const editable = canUpdate && !record.archived
  const fields = [...object.fields].sort((a, b) => Number(b.key === object.labelFieldKey) - Number(a.key === object.labelFieldKey))
  const date = (ms: number) => new Intl.DateTimeFormat(locale === "lt" ? "lt-LT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(ms)

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href={`/app/crm/${object.key}`} className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground">
            <ObjectIcon name={object.icon} className="size-3.5" />
            {object.namePlural}
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="truncate text-foreground">{record.label || "…"}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-stencil-title text-[2.1rem] sm:text-[2.4rem] break-words">{record.label || "…"}</h1>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {object.nameSingular} · {t("crm.record.createdAt")} {date(record.createdAt)} · {t("crm.record.updated")} {date(record.updatedAt)}
            </p>
          </div>
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => archive({ recordIds: [record.id as Id<"crmRecords">], archived: !record.archived }), { success: record.archived ? t("crm.record.restored") : t("crm.record.archived") })}
            >
              {record.archived ? <ArchiveRestore /> : <Archive />}
              {record.archived ? t("crm.record.restore") : t("crm.record.archive")}
            </Button>
          )}
        </div>
        {record.archived && (
          <Alert>
            <Archive />
            <AlertDescription>{t("crm.record.isArchived")}</AlertDescription>
          </Alert>
        )}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <section aria-labelledby="fields-h" className="rounded-xl border bg-card">
          <h2 id="fields-h" className="px-4 pt-4 pb-2 text-sm font-medium">
            {t("crm.record.fields")}
          </h2>
          <dl className="divide-y">
            {fields.map((f) => (
              <FieldRow key={f.id} field={f} detail={detail} editable={editable} />
            ))}
          </dl>
        </section>

        <div className="grid gap-6">
          <Related object={object} objects={objects} detail={detail} />
          <Notes detail={detail} />
        </div>
      </div>
    </div>
  )
}

function FieldRow({ field, detail, editable }: { field: CrmFieldView; detail: CrmRecordDetail; editable: boolean }) {
  const { t } = useT()
  const update = useMutation(api.crm.updateRecord)
  const { run } = useAction()
  const value = detail.record.values[field.key]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<unknown>(value)
  const [invalid, setInvalid] = useState(false)
  const id = `field-${field.key}`

  async function save(next: unknown) {
    const res = await run(() => update({ recordId: detail.record.id as Id<"crmRecords">, values: { [field.key]: next ?? null } }), { onError: () => setInvalid(true) })
    if (res) {
      setEditing(false)
      setInvalid(false)
    }
  }

  function begin() {
    setDraft(value)
    setInvalid(false)
    setEditing(true)
  }

  function keys(e: KeyboardEvent) {
    if (e.key === "Escape") setEditing(false)
    if (e.key === "Enter" && field.type !== "longText" && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save(draft)
    }
    if (e.key === "Enter" && field.type === "longText" && (e.metaKey || e.ctrlKey)) void save(draft)
  }

  const instant = INSTANT.has(field.type)
  return (
    <div className="group/row grid gap-1 px-4 py-2.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="pt-1.5 text-sm text-muted-foreground">
        <label htmlFor={editing || (editable && instant) ? id : undefined}>{field.label}</label>
      </dt>
      <dd className="min-w-0">
        {editable && (instant || editing) ? (
          <div
            onKeyDown={instant ? undefined : keys}
            onBlur={
              instant
                ? undefined
                : (e) => {
                    // Commit when focus leaves the editor, not when it moves inside it.
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void save(draft)
                  }
            }
          >
            <FieldInput
              id={id}
              field={field}
              value={instant ? value : draft}
              relationLabel={typeof value === "string" ? detail.relationLabels[value]?.label : undefined}
              autoFocus={!instant}
              invalid={invalid}
              onChange={(v) => (instant ? void save(v) : setDraft(v))}
            />
            {invalid && <p className="mt-1 text-xs text-destructive">{t("error.VALIDATION")}</p>}
          </div>
        ) : (
          <div className="flex min-h-8 items-center gap-2">
            <div className={cn("min-w-0 flex-1 text-sm", isEmptyValue(value) && "text-muted-foreground")}>
              {isEmptyValue(value) ? (editable ? null : t("common.none")) : <FieldValueDisplay field={field} value={value} relationLabels={detail.relationLabels} />}
              {editable && isEmptyValue(value) && (
                <button type="button" onClick={begin} className="w-full rounded-md py-1 text-left text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {t("crm.record.empty")}
                </button>
              )}
            </div>
            {editable && !isEmptyValue(value) && (
              <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" aria-label={`${t("crm.record.edit")}: ${field.label}`} onClick={begin}>
                <Pencil />
              </Button>
            )}
          </div>
        )}
        {field.description && editing && <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
      </dd>
    </div>
  )
}

function Related({ object, objects, detail }: { object: CrmObjectView; objects: CrmObjectView[]; detail: CrmRecordDetail }) {
  const { t } = useT()
  const canCreate = useCan(CrmPermissions.create)
  const [adding, setAdding] = useState<{ object: CrmObjectView; fieldKey: string } | null>(null)
  // Every relation field anywhere that points at this object, even with no records yet: that's where "add" lives.
  const inbound = objects.flatMap((o) => o.fields.filter((f) => f.type === "relation" && f.settings.objectKey === object.key).map((f) => ({ object: o, field: f })))
  if (inbound.length === 0) return null

  return (
    <section aria-labelledby="related-h" className="grid gap-3">
      <h2 id="related-h" className="text-sm font-medium">
        {t("crm.record.related")}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {inbound.map(({ object: o, field: f }) => {
          const group = detail.related.find((g) => g.objectKey === o.key && g.fieldKey === f.key)
          const label = f.settings.inverseLabel || o.namePlural
          return (
            <div key={`${o.key}.${f.key}`} className="rounded-xl border bg-card">
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <ObjectIcon name={o.icon} className="size-3.5 text-muted-foreground" />
                <h3 className="truncate text-sm font-medium">{label}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">{group?.records.length ?? 0}</span>
                {canCreate && !detail.record.archived && (
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`${t("crm.add")}: ${label}`} onClick={() => setAdding({ object: o, fieldKey: f.key })}>
                    <Plus />
                  </Button>
                )}
              </div>
              {group && group.records.length > 0 ? (
                <ul className="max-h-72 overflow-y-auto px-2 pb-2">
                  {group.records.map((r) => (
                    <li key={r.id}>
                      <Link href={recordHref(o.key, r.id)} className="block truncate rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                        {r.label || "…"}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 pb-3 text-xs text-muted-foreground">{t("crm.record.noRelated")}</p>
              )}
            </div>
          )
        })}
      </div>
      {adding && (
        <RecordFormDialog
          object={adding.object}
          open
          onOpenChange={(v) => !v && setAdding(null)}
          initial={{ [adding.fieldKey]: detail.record.id }}
          initialLabels={{ [adding.fieldKey]: detail.record.label }}
        />
      )}
    </section>
  )
}

function Notes({ detail }: { detail: CrmRecordDetail }) {
  const { t, locale } = useT()
  const canNote = useCan(CrmPermissions.note)
  const canDelete = useCan(CrmPermissions.delete)
  const add = useMutation(api.crm.addNote)
  const remove = useMutation(api.crm.deleteNote)
  const { run, busy } = useAction()
  const [body, setBody] = useState("")
  const date = (ms: number) => new Intl.DateTimeFormat(locale === "lt" ? "lt-LT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(ms)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!body.trim()) return
    const res = await run(() => add({ recordId: detail.record.id as Id<"crmRecords">, body }), { success: t("crm.note.added") })
    if (res) setBody("")
  }

  return (
    <section aria-labelledby="notes-h" className="grid gap-3">
      <h2 id="notes-h" className="text-sm font-medium">
        {t("crm.notes")}
      </h2>
      {canNote && !detail.record.archived && (
        <form onSubmit={submit} className="grid gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("crm.note.placeholder")}
            aria-label={t("crm.note.add")}
            rows={3}
            maxLength={20000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit()
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !body.trim()}>
              {t("crm.note.add")}
            </Button>
          </div>
        </form>
      )}
      {detail.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("crm.note.empty")}</p>
      ) : (
        <ol className="grid gap-3">
          {detail.notes.map((n) => (
            <li key={n.id} className="group/note rounded-xl border bg-card px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.authorName}</span>
                <time dateTime={new Date(n.createdAt).toISOString()} className="tabular-nums">
                  {date(n.createdAt)}
                </time>
                {(n.mine || canDelete) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto opacity-0 group-hover/note:opacity-100 focus-visible:opacity-100"
                    aria-label={t("crm.note.delete")}
                    disabled={busy}
                    onClick={() => void run(() => remove({ noteId: n.id as Id<"crmNotes"> }), { success: t("crm.note.deleted") })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              <p className="mt-1.5 max-w-[70ch] text-sm whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
