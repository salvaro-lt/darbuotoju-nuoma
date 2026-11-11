"use client"
import type { CrmFieldView, CrmListResult, CrmObjectView, CrmRecordView } from "@digimuza/crm"
import type { CurrencyValue } from "@digimuza/crm/fields"
import { CrmPermissions } from "@digimuza/crm/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { MoreHorizontal, Plus } from "lucide-react"
import Link from "next/link"
import { useState, type DragEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatMoney } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { FieldValueDisplay, OPTION_DOT } from "./field-display"
import { fieldByKey, recordHref } from "./use-crm"

const NONE = "__none__"

/**
 * Cards in columns by a select field's options (option order = column order),
 * plus "no value" when any card has none. Drag a card, or use its menu, to
 * move it: that writes the select field. Columns sum the first money field.
 */
export function KanbanBoard({ object, groupBy, columns, result, onAdd }: { object: CrmObjectView; groupBy: string; columns: string[]; result: CrmListResult | undefined; onAdd: (value: string | null) => void }) {
  const { t, locale } = useT()
  const fields = fieldByKey(object)
  const group = fields.get(groupBy)
  const canUpdate = useCan(CrmPermissions.update)
  const canCreate = useCan(CrmPermissions.create)
  const update = useMutation(api.crm.updateRecord)
  const { run } = useAction()
  const [over, setOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  if (!group || group.type !== "select") return <p className="text-sm text-muted-foreground">{t("crm.view.noGroupField")}</p>

  const options = group.settings.options ?? []
  const cardFields = columns.filter((k) => k !== groupBy && k !== object.labelFieldKey).map((k) => fields.get(k)).filter((f): f is CrmFieldView => !!f)
  const money = cardFields.find((f) => f.type === "currency")
  const records = result?.records
  const byValue = new Map<string, CrmRecordView[]>()
  for (const r of records ?? []) {
    const v = typeof r.values[groupBy] === "string" && options.some((o) => o.value === r.values[groupBy]) ? (r.values[groupBy] as string) : NONE
    byValue.set(v, [...(byValue.get(v) ?? []), r])
  }
  const lanes = [...options.map((o) => ({ value: o.value, label: o.label, color: o.color })), ...(byValue.has(NONE) ? [{ value: NONE, label: t("crm.kanban.none"), color: null }] : [])]

  async function move(recordId: string, to: string) {
    const r = records?.find((x) => x.id === recordId)
    const current = r && typeof r.values[groupBy] === "string" ? r.values[groupBy] : NONE
    if (!r || current === to) return
    await run(() => update({ recordId: recordId as Id<"crmRecords">, values: { [groupBy]: to === NONE ? null : to } }), { success: t("crm.kanban.moved") })
  }

  function drop(e: DragEvent, to: string) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData("text/x-crm-record")
    if (id) void move(id, to)
  }

  const total = (rows: CrmRecordView[]) => {
    if (!money) return null
    const sums = new Map<string, number>()
    for (const r of rows) {
      const c = r.values[money.key] as CurrencyValue | undefined
      if (c) sums.set(c.currency, (sums.get(c.currency) ?? 0) + c.amount)
    }
    return [...sums].map(([cur, amount]) => formatMoney(amount, cur, locale)).join(" · ") || null
  }

  return (
    // Lanes scroll sideways on their own, so the page keeps its width.
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
      <div className="flex min-h-[28rem] gap-3">
        {lanes.map((lane) => {
          const rows = byValue.get(lane.value) ?? []
          const sum = total(rows)
          return (
            <section
              key={lane.value}
              aria-label={lane.label}
              onDragOver={(e) => {
                if (!canUpdate || !dragging) return
                e.preventDefault()
                setOver(lane.value)
              }}
              onDragLeave={() => setOver((o) => (o === lane.value ? null : o))}
              onDrop={(e) => drop(e, lane.value)}
              className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 transition-colors duration-150", over === lane.value && "bg-accent ring-2 ring-ring/40")}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                {lane.color && <span className={cn("size-2 rounded-full", OPTION_DOT[lane.color])} aria-hidden />}
                <h2 className="truncate text-sm font-medium">{lane.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{records ? rows.length : ""}</span>
                {canCreate && lane.value !== NONE && (
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`${t("crm.add")}: ${lane.label}`} onClick={() => onAdd(lane.value)}>
                    <Plus />
                  </Button>
                )}
              </header>
              {sum && <p className="-mt-1 px-3 pb-2 text-xs text-muted-foreground tabular-nums">{sum}</p>}
              <ol className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {records === undefined && [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
                {records && rows.length === 0 && <li className="px-1 py-6 text-center text-xs text-muted-foreground">{t("crm.kanban.empty")}</li>}
                {rows.map((r) => (
                  <li
                    key={r.id}
                    draggable={canUpdate}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/x-crm-record", r.id)
                      e.dataTransfer.effectAllowed = "move"
                      setDragging(r.id)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                    className={cn(
                      "group/card relative rounded-lg border bg-card p-3 shadow-xs transition-[box-shadow,opacity] duration-150 hover:shadow-sm",
                      canUpdate && "cursor-grab active:cursor-grabbing",
                      dragging === r.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Link href={recordHref(object.key, r.id)} className="min-w-0 flex-1 text-sm font-medium break-words underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-none">
                        {r.label || "…"}
                      </Link>
                      {canUpdate && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" className="relative z-10 -my-1 -mr-1 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`${t("crm.kanban.moveTo")}: ${r.label}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("crm.kanban.moveTo")}</DropdownMenuLabel>
                            {options.map((o) => (
                              <DropdownMenuItem key={o.value} disabled={r.values[groupBy] === o.value} onSelect={() => void move(r.id, o.value)}>
                                <span className={cn("size-2 rounded-full", OPTION_DOT[o.color])} aria-hidden />
                                {o.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {cardFields.some((f) => r.values[f.key] !== undefined) && (
                      <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {cardFields.map((f) =>
                          r.values[f.key] === undefined ? null : (
                            <div key={f.key} className="flex min-w-0 items-center gap-2">
                              <dt className="sr-only">{f.label}</dt>
                              <dd className="min-w-0 truncate text-foreground/80 [&_a]:relative [&_a]:z-10">
                                <FieldValueDisplay field={f} value={r.values[f.key]} relationLabels={result!.relationLabels} compact />
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}
