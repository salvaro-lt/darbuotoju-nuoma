"use client"
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type { ColumnDef }

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Right-align (numbers, row actions). */
    align?: "end"
    className?: string
  }
}

/**
 * App list table: shadcn Table + TanStack Table (sortable headers where the
 * column has an accessor). Skeleton rows while `rows` is undefined. Render the
 * empty state yourself when `rows` is an empty array. Rows fade in when they
 * mount: over the skeleton on first load, and one by one as live updates add them.
 */
export function DataTable<T>({ rows, columns, label, getRowId }: { rows: T[] | undefined; columns: ColumnDef<T>[]; label: string; getRowId?: (row: T) => string }) {
  const [sorting, setSorting] = useState<SortingState>([])
  // TanStack Table returns non-memoizable functions; the React Compiler lint knows.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getRowId ? { getRowId } : {}),
  })

  return (
    <div className="overflow-hidden rounded-xl border bg-card" role="region" aria-label={label}>
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort()
                const dir = h.column.getIsSorted()
                return (
                  <TableHead key={h.id} className={cn("h-10 px-4 text-xs font-medium text-muted-foreground", h.column.columnDef.meta?.align === "end" && "text-right", h.column.columnDef.meta?.className)}>
                    {h.isPlaceholder ? null : sortable ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows === undefined
            ? Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {columns.map((_c, j) => (
                    <TableCell key={j} className="h-12 px-4">
                      <Skeleton className="h-4 w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined} className="animate-fade-in">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn("h-12 px-4", cell.column.columnDef.meta?.align === "end" && "text-right tabular-nums", cell.column.columnDef.meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}
