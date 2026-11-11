"use client"
import type { CrmFieldView, CrmObjectView } from "@digimuza/crm"
import { CrmFlags } from "@digimuza/crm/manifest"
import { useFeatureFlag } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ChevronRight, Lock, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { FieldDialog } from "./field-dialog"
import { IconPicker } from "./icon-picker"
import { ObjectIcon } from "./icons"
import { useCrmSchema } from "./use-crm"

const LABEL_TYPES = new Set(["text", "email", "phone", "url"])

export function ObjectSettings({ objectKey }: { objectKey: string }) {
  const { t } = useT()
  const { enabled, objects } = useCrmSchema(true)
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crm.disabled")}</p>
  if (!objects) return <Skeleton className="h-96 rounded-xl" />
  const object = objects.find((o) => o.key === objectKey)
  if (!object) return <EmptyState icon={<Archive />} title={t("crm.list.noMatch.title")} body={t("crm.objectMissing")} />
  return <Loaded key={object.id} object={object} objects={objects.filter((o) => !o.archived)} />
}

function Loaded({ object, objects }: { object: CrmObjectView; objects: CrmObjectView[] }) {
  const { t } = useT()
  const customFields = useFeatureFlag(CrmFlags.customFields)
  const setArchived = useMutation(api.crm.setObjectArchived)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState<CrmFieldView | "new" | null>(null)
  const active = object.fields.filter((f) => !f.archived)
  const archived = object.fields.filter((f) => f.archived)

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/app/crm/settings" className="rounded-sm hover:text-foreground">
            {t("crm.settings.back")}
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="truncate text-foreground">{object.namePlural}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <ObjectIcon name={object.icon} className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-stencil-title text-[2.1rem] sm:text-[2.4rem]">{object.namePlural}</h1>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">{object.key}</code> · {object.isStandard ? t("crm.object.standard") : t("crm.object.custom")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!object.archived && (
              <Button variant="outline" asChild>
                <Link href={`/app/crm/${object.key}`}>{t("crm.record.open")}</Link>
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => setArchived({ objectId: object.id as Id<"crmObjects">, archived: !object.archived }), { success: object.archived ? t("crm.object.restoredToast") : t("crm.object.archivedToast") })}
            >
              {object.archived ? <ArchiveRestore /> : <Archive />}
              {object.archived ? t("crm.object.restore") : t("crm.object.archive")}
            </Button>
          </div>
        </div>
        {object.archived && (
          <Alert>
            <Archive />
            <AlertDescription>{t("crm.object.archivedHint")}</AlertDescription>
          </Alert>
        )}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ObjectForm object={object} />

        <section aria-labelledby="fields-h" className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="fields-h" className="text-base font-semibold">
              {t("crm.object.fields")} <span className="text-sm font-normal text-muted-foreground tabular-nums">{active.length}</span>
            </h2>
            {customFields && (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                {t("crm.field.new")}
              </Button>
            )}
          </div>
          {!customFields && <p className="text-sm text-muted-foreground">{t("crm.field.customOff")}</p>}
          <FieldList object={object} fields={active} onEdit={setEditing} />
          {archived.length > 0 && (
            <Collapsible className="mt-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                  {t("crm.field.archivedSection")} <span className="tabular-nums">({archived.length})</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 grid gap-2">
                <p className="text-xs text-muted-foreground">{t("crm.field.archivedHint")}</p>
                <FieldList object={object} fields={archived} onEdit={setEditing} archivedList />
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      </div>

      {editing && <FieldDialog object={object} objects={objects} {...(editing === "new" ? {} : { field: editing })} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ObjectForm({ object }: { object: CrmObjectView }) {
  const { t } = useT()
  const update = useMutation(api.crm.updateObject)
  const { run, busy } = useAction()
  const [singular, setSingular] = useState(object.nameSingular)
  const [plural, setPlural] = useState(object.namePlural)
  const [description, setDescription] = useState(object.description ?? "")
  const [icon, setIcon] = useState(object.icon)
  const [labelField, setLabelField] = useState(object.labelFieldKey)
  const dirty = singular !== object.nameSingular || plural !== object.namePlural || description !== (object.description ?? "") || icon !== object.icon || labelField !== object.labelFieldKey

  async function submit(e: FormEvent) {
    e.preventDefault()
    await run(() => update({ objectId: object.id as Id<"crmObjects">, nameSingular: singular, namePlural: plural, description, icon, labelFieldKey: labelField }), { success: t("crm.object.saved") })
  }

  return (
    <form onSubmit={submit} aria-labelledby="object-h" className="grid gap-5 rounded-xl border bg-card p-5">
      <h2 id="object-h" className="text-base font-semibold">
        {t("crm.object.details")}
      </h2>
      <FieldGroup className="gap-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
          <Field>
            <FieldLabel htmlFor="o-icon">{t("crm.object.icon")}</FieldLabel>
            <IconPicker id="o-icon" value={icon} onChange={setIcon} />
          </Field>
          <Field>
            <FieldLabel htmlFor="o-singular">{t("crm.object.singular")}</FieldLabel>
            <Input id="o-singular" required maxLength={80} value={singular} onChange={(e) => setSingular(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="o-plural">{t("crm.object.plural")}</FieldLabel>
          <Input id="o-plural" required maxLength={80} value={plural} onChange={(e) => setPlural(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="o-desc">{t("common.description")}</FieldLabel>
          <Input id="o-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="o-label">{t("crm.object.labelField")}</FieldLabel>
          <Select value={labelField} onValueChange={setLabelField}>
            <SelectTrigger id="o-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {object.fields
                .filter((f) => !f.archived && LABEL_TYPES.has(f.type))
                .map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("crm.object.labelFieldHint")}</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}

function FieldList({ object, fields, onEdit, archivedList }: { object: CrmObjectView; fields: CrmFieldView[]; onEdit: (f: CrmFieldView) => void; archivedList?: boolean }) {
  const { t } = useT()
  const reorder = useMutation(api.crm.reorderFields)
  const setArchived = useMutation(api.crm.setFieldArchived)
  const { run, busy } = useAction()

  const move = (i: number, d: -1 | 1) => {
    const ids = object.fields.filter((f) => !f.archived).map((f) => f.id as Id<"crmFields">)
    ;[ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!]
    void run(() => reorder({ objectId: object.id as Id<"crmObjects">, fieldIds: ids }))
  }

  return (
    <ol className="divide-y overflow-hidden rounded-xl border bg-card">
      {fields.map((f, i) => {
        const isLabel = f.key === object.labelFieldKey
        return (
          <li key={f.id} className="group/f flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={archivedList ? "truncate text-muted-foreground" : "truncate font-medium"}>{f.label}</span>
                {isLabel && <Badge variant="secondary">{t("crm.field.isLabel")}</Badge>}
                {f.required && !isLabel && (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {t("crm.field.required")}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {t(`crm.type.${f.type}` as MessageKey)}
                {f.type === "relation" && f.settings.objectKey ? ` → ${f.settings.objectKey}` : ""}
                {(f.type === "select" || f.type === "multiSelect") && ` · ${f.settings.options?.length ?? 0}`} · <code className="font-mono">{f.key}</code>
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              {!archivedList && (
                <span className="flex opacity-0 transition-opacity group-hover/f:opacity-100 focus-within:opacity-100">
                  <Button variant="ghost" size="icon-xs" aria-label={`${t("crm.field.moveUp")}: ${f.label}`} disabled={i === 0 || busy} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`${t("crm.field.moveDown")}: ${f.label}`} disabled={i === fields.length - 1 || busy} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                </span>
              )}
              {!archivedList && (
                <Button variant="ghost" size="icon-sm" aria-label={`${t("crm.field.edit")}: ${f.label}`} onClick={() => onEdit(f)}>
                  <Pencil />
                </Button>
              )}
              {isLabel ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="grid size-7 place-items-center text-muted-foreground" tabIndex={0} aria-label={t("crm.field.labelLocked")}>
                      <Lock className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("crm.field.labelLocked")}</TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`${archivedList ? t("crm.field.restore") : t("crm.field.archive")}: ${f.label}`}
                  onClick={() => void run(() => setArchived({ fieldId: f.id as Id<"crmFields">, archived: !archivedList }), { success: archivedList ? t("crm.field.restoredToast") : t("crm.field.archivedToast") })}
                >
                  {archivedList ? <ArchiveRestore /> : <Archive />}
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
