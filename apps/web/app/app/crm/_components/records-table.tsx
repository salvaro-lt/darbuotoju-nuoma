"use client"
import type { CrmListResult, CrmObjectView, CrmRecordView } from "@digimuza/crm"
import type { ViewSort } from "@digimuza/crm/fields"
import { ArrowDown, ArrowUp } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { FieldValueDisplay } from "./field-display"
import { fieldByKey, recordHref } from "./use-crm"

const RIGHT = new Set(["number", "currency", "rating"])
/** Types that render their own link: never nested inside the row link. */
const LINKS = new Set(["relation", "email", "url"])

/**
 * Records as a dense table. Sorting is the view's (server side): clicking a
 * header cycles asc → desc → none. Rows open the record page.
 */
export function RecordsTable({
  object,
  columns,
  result,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  object: CrmObjectView
  columns: string[]
  result: CrmListResult | undefined
  sort: ViewSort | null
  onSort: (s: ViewSort | null) => void
  selected: Set<string> | null
  onSelect: (ids: Set<string>) => void
}) {
  const { t } = useT()
  const router = useRouter()
  const fields = fieldByKey(object)
  const cols = columns.map((k) => fields.get(k)).filter((f) => f !== undefined)
  const rows = result?.records
  const allOn = !!rows?.length && !!selected && rows.every((r) => selected.has(r.id))

  const cycle = (key: string) => {
    if (sort?.fieldKey !== key) return onSort({ fieldKey: key, direction: "asc" })
    if (sort.direction === "asc") return onSort({ fieldKey: key, direction: "desc" })
    onSort(null)
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card" role="region" aria-label={object.namePlural}>
      <Table className="min-w-max">
        <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
          <TableRow className="hover:bg-transparent">
            {selected && (
              <TableHead className="w-10 px-3">
                <Checkbox aria-label={t("crm.selectAll")} checked={allOn} onCheckedChange={(v) => onSelect(v && rows ? new Set(rows.map((r) => r.id)) : new Set())} />
              </TableHead>
            )}
            {cols.map((f, i) => {
              const dir = sort?.fieldKey === f.key ? sort.direction : null
              return (
                <TableHead
                  key={f.key}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  className={cn("h-10 px-4 text-xs font-medium text-muted-foreground", RIGHT.has(f.type) && "text-right", i === 0 && "min-w-56")}
                >
                  <button type="button" className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", dir && "text-foreground")} onClick={() => cycle(f.key)}>
                    {f.label}
                    {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : null}
                  </button>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows === undefined
            ? Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {selected && <TableCell className="px-3" />}
                  {cols.map((f) => (
                    <TableCell key={f.key} className="h-11 px-4">
                      <Skeleton className="h-4 w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((r) => (
                <Row key={r.id} record={r} cols={cols} relationLabels={result!.relationLabels} selected={selected} onSelect={onSelect} onOpen={() => router.push(recordHref(object.key, r.id))} />
              ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Row({
  record,
  cols,
  relationLabels,
  selected,
  onSelect,
  onOpen,
}: {
  record: CrmRecordView
  cols: CrmObjectView["fields"]
  relationLabels: CrmListResult["relationLabels"]
  selected: Set<string> | null
  onSelect: (ids: Set<string>) => void
  onOpen: () => void
}) {
  const { t } = useT()
  const on = selected?.has(record.id) ?? false
  return (
    <TableRow data-state={on ? "selected" : undefined} className="cursor-pointer" onClick={onOpen}>
      {selected && (
        <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`${t("crm.selectRow")}: ${record.label}`}
            checked={on}
            onCheckedChange={(v) => {
              const n = new Set(selected)
              if (v) n.add(record.id)
              else n.delete(record.id)
              onSelect(n)
            }}
          />
        </TableCell>
      )}
      {cols.map((f, i) => (
        <TableCell key={f.key} className={cn("h-11 max-w-80 px-4", RIGHT.has(f.type) && "text-right")}>
          {i === 0 ? (
            // The title cell is the row's real link: keyboard and middle-click work.
            <Link href={recordHref(record.objectKey, record.id)} className="block truncate font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none" onClick={(e) => e.stopPropagation()}>
              {record.values[f.key] !== undefined && !LINKS.has(f.type) ? <FieldValueDisplay field={f} value={record.values[f.key]} relationLabels={relationLabels} compact /> : record.label || "…"}
            </Link>
          ) : (
            <span className={cn("flex min-w-0 items-center", RIGHT.has(f.type) && "justify-end")}>
              <FieldValueDisplay field={f} value={record.values[f.key]} relationLabels={relationLabels} compact />
            </span>
          )}
        </TableCell>
      ))}
    </TableRow>
  )
}
