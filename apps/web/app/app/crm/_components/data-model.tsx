"use client"
import { keyFromLabel } from "@digimuza/crm/fields"
import { CrmFlags } from "@digimuza/crm/manifest"
import { useFeatureFlag } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { ArrowDown, ArrowUp, ChevronRight, Database, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { IconPicker } from "./icon-picker"
import { ObjectIcon } from "./icons"
import { useCrmSchema } from "./use-crm"

/** Settings home: every object (archived ones too), its fields count, order and status. */
export function DataModel() {
  const { t } = useT()
  const { enabled, objects } = useCrmSchema(true)
  const customOn = useFeatureFlag(CrmFlags.customObjects)
  const reorder = useMutation(api.crm.reorderObjects)
  const install = useMutation(api.crm.applyBlueprint)
  const { run, busy } = useAction()
  const [creating, setCreating] = useState(false)

  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crm.disabled")}</p>

  const move = (i: number, d: -1 | 1) => {
    if (!objects) return
    const ids = objects.map((o) => o.id as Id<"crmObjects">)
    ;[ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!]
    void run(() => reorder({ objectIds: ids }))
  }

  return (
    <>
      <PageHeader
        title={t("crm.settings")}
        lead={t("crm.settings.lead")}
        actions={
          customOn ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t("crm.object.new")}
            </Button>
          ) : undefined
        }
      />
      {!customOn && <p className="-mt-3 mb-6 text-sm text-muted-foreground">{t("crm.object.customOff")}</p>}

      {objects === undefined ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : objects.length === 0 ? (
        <EmptyState
          icon={<Database />}
          title={t("crm.empty.title")}
          body={t("crm.empty.body")}
          action={
            <Button disabled={busy} onClick={() => void run(() => install({}), { success: t("crm.installed") })}>
              {t("crm.empty.install")}
            </Button>
          }
        />
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border bg-card">
          {objects.map((o, i) => (
            <li key={o.id} className={cn("group/obj relative flex items-center gap-3 px-4 py-3 hover:bg-muted/40", o.archived && "bg-muted/40")}>
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", o.archived && "opacity-60")}>
                <ObjectIcon name={o.icon} className="size-4.5" />
              </span>
              <Link href={`/app/crm/settings/${o.key}`} className="min-w-0 flex-1 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset">
                <span className={cn("flex items-center gap-2 font-medium", o.archived && "text-muted-foreground")}>
                  <span className="truncate">{o.namePlural}</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {o.isStandard ? t("crm.object.standard") : t("crm.object.custom")}
                  </Badge>
                  {o.archived && <Badge variant="secondary">{t("crm.object.archived")}</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  <code className="font-mono">{o.key}</code> · {t("crm.object.fields")}: <span className="tabular-nums">{o.fields.filter((f) => !f.archived).length}</span>
                </span>
              </Link>
              <div className="relative z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/obj:opacity-100 focus-within:opacity-100">
                <Button variant="ghost" size="icon-xs" aria-label={`${t("crm.object.moveUp")}: ${o.namePlural}`} disabled={i === 0 || busy} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`${t("crm.object.moveDown")}: ${o.namePlural}`} disabled={i === objects.length - 1 || busy} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </li>
          ))}
        </ol>
      )}
      {creating && <NewObjectDialog onClose={() => setCreating(false)} />}
    </>
  )
}

function NewObjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const create = useMutation(api.crm.createObject)
  const { run, busy } = useAction()
  const [singular, setSingular] = useState("")
  const [plural, setPlural] = useState("")
  const [key, setKey] = useState("")
  const [icon, setIcon] = useState("folder")
  const [invalid, setInvalid] = useState<string[]>([])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => create({ nameSingular: singular, namePlural: plural, icon, ...(key.trim() ? { key: key.trim() } : {}) }), { success: t("crm.object.created"), onError: (err) => setInvalid(err.fields) })
    if (!res) return
    onClose()
    router.push(`/app/crm/settings/${res.key}`)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("crm.object.new")}</DialogTitle>
            <DialogDescription>{t("crm.object.newLead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
              <Field>
                <FieldLabel htmlFor="obj-icon">{t("crm.object.icon")}</FieldLabel>
                <IconPicker id="obj-icon" value={icon} onChange={setIcon} />
              </Field>
              <Field data-invalid={invalid.includes("nameSingular") || undefined}>
                <FieldLabel htmlFor="obj-singular">{t("crm.object.singular")}</FieldLabel>
                <Input id="obj-singular" required autoFocus maxLength={80} value={singular} onChange={(e) => setSingular(e.target.value)} />
              </Field>
            </div>
            <Field data-invalid={invalid.includes("namePlural") || undefined}>
              <FieldLabel htmlFor="obj-plural">{t("crm.object.plural")}</FieldLabel>
              <Input id="obj-plural" required maxLength={80} value={plural} onChange={(e) => setPlural(e.target.value)} />
            </Field>
            <Field data-invalid={invalid.includes("key") || undefined}>
              <FieldLabel htmlFor="obj-key">{t("crm.object.key")}</FieldLabel>
              <Input id="obj-key" className="font-mono" placeholder={keyFromLabel(singular) || "project"} value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={invalid.includes("key") || undefined} />
              <FieldDescription>{t("crm.object.keyHint")}</FieldDescription>
            </Field>
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

