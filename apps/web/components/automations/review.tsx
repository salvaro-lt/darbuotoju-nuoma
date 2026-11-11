"use client"
// "Laukia patvirtinimo": the original message next to the extracted fields
// (editable before approval), the proposed actions, approve / reject, bulk approve.
import { AutomationsPermissions, type AutomationField, type RunView } from "@digimuza/system-core/automations"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Check, CheckCheck, Inbox, Loader2, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ReviewSkeleton } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { InputPreview, MessageCard } from "./runs"
import { convexApi as api, relativeTime, targetLabel, useIsDesktop } from "./shared"

export function ReviewQueue() {
  const { t, locale } = useT()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const canReview = useCan(AutomationsPermissions.review)
  const page = useQuery(api.automations.listRuns, { status: "pending_review", limit: 100 })
  const bulk = useMutation(api.automations.bulkReviewRuns)
  const { run, busy } = useAction()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const items = useMemo(() => page?.items ?? [], [page])
  const current = params.get("run")
  const active = items.find((r) => r.id === current) ?? null
  const open = (id: string | null) => router.replace(id ? `${pathname}?run=${id}` : pathname, { scroll: false })
  const desktop = useIsDesktop()

  // Desktop: keep a run open; after approving one, move to the next.
  useEffect(() => {
    if (!page || active) return
    if (desktop && items[0]) open(items[0].id)
    else if (current && !items.some((r) => r.id === current)) open(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, active, current, desktop])

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  async function approveSelected() {
    const ids = [...selected].filter((id) => items.some((r) => r.id === id)).slice(0, 25)
    const res = await run(() => bulk({ runIds: ids, approve: true }))
    if (!res) return
    setSelected(new Set())
    const { toast } = await import("sonner")
    toast.success(t("auto.review.bulkDone").replace("{inserted}", String(res.inserted)).replace("{skipped}", String(res.skipped + res.failed)))
  }

  if (page === undefined) return <ReviewSkeleton />
  if (!items.length) return <EmptyState icon={<Inbox />} title={t("auto.review.empty")} body={t("auto.review.emptyBody")} />

  return (
    <div className="grid animate-fade-in gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <aside aria-label={t("auto.review.list")} className="grid content-start gap-2">
        {canReview && (
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.size > 0 && selected.size === Math.min(items.length, 25)} onCheckedChange={(v) => setSelected(v ? new Set(items.slice(0, 25).map((r) => r.id)) : new Set())} />
              {t("auto.review.selectAll")}
            </label>
            <Button size="sm" disabled={!selected.size || busy} onClick={() => void approveSelected()}>
              {busy ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              {t("auto.review.approveSelected")} {selected.size > 0 && `(${selected.size})`}
            </Button>
          </div>
        )}
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((r) => (
            <li key={r.id} className={cn("flex items-start gap-3 px-3 py-3", r.id === current && "bg-primary/5")}>
              {canReview && <Checkbox className="mt-1" aria-label={t("auto.review.select")} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />}
              <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => open(r.id)}>
                <span className="truncate text-sm font-medium">{r.message?.subject || r.message?.fromName || r.message?.from || t("auto.runs.noSubject")}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {r.automationName} · {r.message?.from || "—"}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {relativeTime(r.createdAt, locale)}
                  {(r.errors.length > 0 || r.proposed.some((p) => p.issues.length)) && <Badge variant="destructive">{t("auto.review.needsFix")}</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="hidden min-w-0 lg:block">{active ? <ReviewItem key={active.id} run={active} canReview={canReview} /> : null}</section>

      <Sheet open={!!active && !desktop} onOpenChange={(v) => !v && open(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl lg:hidden">
          <SheetHeader className="border-b">
            <SheetTitle>{t("auto.review.title")}</SheetTitle>
            <SheetDescription>{active?.automationName}</SheetDescription>
          </SheetHeader>
          <div className="p-4">{active && <ReviewItem key={active.id} run={active} canReview={canReview} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ReviewItem({ run, canReview }: { run: RunView; canReview: boolean }) {
  const { t } = useT()
  const data = useQuery(api.automations.getRun, { runId: run.id })
  const review = useMutation(api.automations.reviewRun)
  const { run: act, busy } = useAction()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(run.fields.map((f) => [f.name, toInput(f, run.extracted?.[f.name])])))
  const [note, setNote] = useState("")
  const edited = run.fields.filter((f) => values[f.name] !== toInput(f, run.extracted?.[f.name]))

  async function decide(approve: boolean) {
    const fields = approve && edited.length ? Object.fromEntries(edited.map((f) => [f.name, fromInput(f, values[f.name] ?? "")])) : undefined
    const res = await act(() => review({ runId: run.id, approve, ...(fields ? { fields } : {}), ...(note.trim() ? { note } : {}) }))
    if (!res) return
    const { toast } = await import("sonner")
    if (res.status === "inserted") toast.success(t("auto.review.inserted"))
    else if (res.status === "rejected") toast.success(t("auto.review.rejected"))
    else toast.error(t("auto.review.failed"), { description: res.error ? `${res.error.code}: ${res.error.message}` : undefined, duration: 10000 })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-semibold">{t("auto.review.original")}</h3>
        {data?.event ? <MessageCard event={data.event} /> : <Skeleton className="h-48 rounded-xl" />}
      </div>
      <div className="grid content-start gap-4">
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("auto.review.fields")}</h3>
            {edited.length > 0 && <Badge variant="secondary">{t("auto.review.editedCount").replace("{n}", String(edited.length))}</Badge>}
          </div>
          {run.fields.map((f) => (
            <FieldInput key={f.name} field={f} value={values[f.name] ?? ""} error={run.errors.find((e) => e.startsWith(`${f.name}:`))} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          ))}
        </section>
        <section className="grid gap-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{t("auto.review.proposed")}</h3>
          <ol className="grid gap-3">
            {run.proposed.map((p, i) => (
              <li key={i} className="grid gap-1.5">
                <p className="text-sm font-medium">
                  {i + 1}. {targetLabel(t, p.targetId)}
                </p>
                <InputPreview input={p.input} />
                {p.issues.length > 0 && (
                  <ul className="list-disc pl-5 text-[13px] text-amber-700 dark:text-amber-300">
                    {p.issues.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {edited.length > 0 && <p className="text-xs text-muted-foreground">{t("auto.review.previewNote")}</p>}
        </section>
        {canReview && (
          <div className="grid gap-3">
            <Textarea rows={2} value={note} maxLength={500} placeholder={t("auto.review.note")} aria-label={t("auto.review.note")} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
                <X />
                {t("auto.review.reject")}
              </Button>
              <Button disabled={busy} onClick={() => void decide(true)}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t("auto.review.approve")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function toInput(f: AutomationField, v: unknown): string {
  if (v === null || v === undefined) return ""
  if (Array.isArray(v)) return v.join(", ")
  return String(v)
}

function fromInput(f: AutomationField, s: string): unknown {
  const v = s.trim()
  if (!v) return null
  if (f.type === "array") return v.split(",").map((x) => x.trim()).filter(Boolean)
  return v
}

function FieldInput({ field, value, error, onChange }: { field: AutomationField; value: string; error?: string | undefined; onChange: (v: string) => void }) {
  const { t } = useT()
  const id = `rv-${field.name}`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className="flex items-center gap-1.5">
        <span className="font-mono text-[13px]">{field.name}</span>
        {field.required && <span className="text-destructive">*</span>}
        <span className="text-xs font-normal text-muted-foreground">{t(`auto.type.${field.type}` as MessageKey)}</span>
      </FieldLabel>
      {field.type === "enum" ? (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={value}
          aria-invalid={!!error}
          type={field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Field>
  )
}
