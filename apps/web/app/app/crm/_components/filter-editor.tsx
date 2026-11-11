"use client"
import type { CrmFieldView, CrmObjectView } from "@digimuza/crm"
import { operatorsFor, type FilterOperator, type ViewFilter } from "@digimuza/crm/fields"
import { ListFilter, Plus, X } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { FieldInput, RecordPicker } from "./field-input"

const NO_VALUE: FilterOperator[] = ["isEmpty", "isNotEmpty"]

/** A sensible first filter for a field: what most people want to ask of it. */
function defaultFilter(field: CrmFieldView): ViewFilter {
  const op = operatorsFor(field.type)[0]!
  if (field.type === "boolean") return { fieldKey: field.key, operator: "eq", value: true }
  return { fieldKey: field.key, operator: op, ...(op === "in" ? { value: [] } : {}) }
}

/** Filter chips plus a popover to edit them. Filters apply live; saving them to the view is separate. */
export function FilterEditor({ object, filters, onChange }: { object: CrmObjectView; filters: ViewFilter[]; onChange: (f: ViewFilter[]) => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const byKey = new Map(object.fields.map((f) => [f.key, f]))
  const valid = filters.filter((f) => byKey.has(f.fieldKey))
  const set = (i: number, f: ViewFilter) => onChange(valid.map((x, j) => (j === i ? f : x)))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("crm.filter")}>
          <ListFilter />
          <span className="hidden sm:inline">{t("crm.filter")}</span>
          {valid.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 tabular-nums">
              {valid.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-3">
        <div className="grid gap-2">
          {valid.map((f, i) => {
            const field = byKey.get(f.fieldKey)!
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[10rem_9rem_minmax(0,1fr)_auto]">
                <Select value={f.fieldKey} onValueChange={(k) => set(i, defaultFilter(byKey.get(k)!))}>
                  <SelectTrigger size="sm" className="w-full" aria-label={t("crm.field.label")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {object.fields.map((x) => (
                      <SelectItem key={x.key} value={x.key}>
                        {x.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={f.operator} onValueChange={(op) => set(i, { ...f, operator: op as FilterOperator, ...(op === "in" && !Array.isArray(f.value) ? { value: [] } : {}) })}>
                  <SelectTrigger size="sm" className="w-full" aria-label={t("crm.filter")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operatorsFor(field.type).map((op) => (
                      <SelectItem key={op} value={op}>
                        {t(`crm.op.${op}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  {!NO_VALUE.includes(f.operator) && <FilterValue field={field} filter={f} onChange={(value) => set(i, { ...f, value })} id={`filter-${i}`} />}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t("crm.removeFilter")} onClick={() => onChange(valid.filter((_, j) => j !== i))} className="col-start-3 row-start-1 sm:col-start-auto">
                  <X />
                </Button>
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Select value="" onValueChange={(k) => onChange([...valid, defaultFilter(byKey.get(k)!)])}>
              <SelectTrigger size="sm" className="w-fit gap-1.5 border-dashed" aria-label={t("crm.addFilter")}>
                <Plus className="size-3.5" />
                <SelectValue placeholder={t("crm.addFilter")} />
              </SelectTrigger>
              <SelectContent>
                {object.fields.map((x) => (
                  <SelectItem key={x.key} value={x.key}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {valid.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                {t("crm.clearFilters")}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FilterValue({ field, filter, onChange, id }: { field: CrmFieldView; filter: ViewFilter; onChange: (v: unknown) => void; id: string }) {
  const { t } = useT()
  const v = filter.value
  if (filter.operator === "in" || (field.type === "multiSelect" && filter.operator === "contains")) {
    return <FieldInput id={id} field={{ ...field, type: "multiSelect", required: false }} value={Array.isArray(v) ? v : []} onChange={(x) => onChange(x ?? [])} />
  }
  switch (field.type) {
    case "select":
      return <FieldInput id={id} field={{ ...field, required: true }} value={typeof v === "string" ? v : undefined} onChange={onChange} />
    case "boolean":
      return (
        <Select value={v === false ? "no" : "yes"} onValueChange={(x) => onChange(x === "yes")}>
          <SelectTrigger size="sm" className="w-full" aria-label={t("crm.filterValue")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">{t("crm.yes")}</SelectItem>
            <SelectItem value="no">{t("crm.no")}</SelectItem>
          </SelectContent>
        </Select>
      )
    case "relation":
      return <RecordPicker id={id} objectKey={field.settings.objectKey ?? ""} value={typeof v === "string" ? v : undefined} onChange={onChange} />
    case "number":
    case "rating":
      return <Input id={id} className="h-7 tabular-nums" inputMode="decimal" aria-label={t("crm.filterValue")} value={typeof v === "number" ? String(v) : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value.replace(",", ".")))} />
    case "currency":
      return (
        <Input
          id={id}
          className="h-7 tabular-nums"
          inputMode="decimal"
          aria-label={t("crm.filterValue")}
          value={typeof v === "object" && v !== null ? String((v as { amount: number }).amount / 100) : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : { amount: Math.round(Number(e.target.value.replace(",", ".")) * 100) })}
        />
      )
    case "date":
      return <Input id={id} type="date" className="h-7 tabular-nums" aria-label={t("crm.filterValue")} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value || undefined)} />
    case "dateTime":
      return <Input id={id} type="date" className="h-7 tabular-nums" aria-label={t("crm.filterValue")} value={typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : ""} onChange={(e) => onChange(e.target.value ? Date.parse(`${e.target.value}T00:00:00`) : undefined)} />
    default:
      return <Input id={id} className="h-7" aria-label={t("crm.filterValue")} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value)} />
  }
}
