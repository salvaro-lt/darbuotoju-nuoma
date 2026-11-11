"use client"
import type { LabelView, TagView } from "@digimuza/documents"
import { Check, ChevronsUpDown, Inbox, Tags } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

/** Readable text on a tag's own colour (WCAG relative luminance). */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const l = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
  return l > 0.4 ? "#111827" : "#ffffff"
}

/** A tag in its colour. Inbox tags carry the inbox icon. */
export function TagChip({ tag, className }: { tag: Pick<TagView, "name" | "color" | "isInbox">; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium", className)}
      style={{ backgroundColor: tag.color, color: inkOn(tag.color) }}
    >
      {tag.isInbox && <Inbox className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

export function TagChips({ ids, tags, max = 4 }: { ids: string[]; tags: TagView[]; max?: number }) {
  const list = ids.map((id) => tags.find((t) => t.id === id)).filter((t) => t !== undefined)
  if (list.length === 0) return null
  // Inbox tags first: they ask for attention.
  list.sort((a, b) => Number(b.isInbox) - Number(a.isInbox))
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {list.slice(0, max).map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {list.length > max && <span className="text-xs text-muted-foreground tabular-nums">+{list.length - max}</span>}
    </span>
  )
}

/** Multi-select of tags in a popover with search. */
export function TagPicker({
  tags,
  value,
  onChange,
  label,
  size = "sm",
  footer,
  className,
}: {
  tags: TagView[]
  value: string[]
  onChange: (ids: string[]) => void
  label: string
  size?: "sm" | "default"
  footer?: ReactNode
  className?: string
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const chosen = value.map((id) => tags.find((x) => x.id === id)).filter((x) => x !== undefined)
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size={size} aria-label={label} className={cn("justify-between", className)}>
          <span className="flex min-w-0 items-center gap-1.5">
            <Tags className="shrink-0" />
            {chosen.length === 0 ? (
              <span className={cn(size === "default" && "text-muted-foreground")}>{label}</span>
            ) : chosen.length <= 2 ? (
              <span className="flex min-w-0 gap-1">
                {chosen.map((x) => (
                  <TagChip key={x.id} tag={x} />
                ))}
              </span>
            ) : (
              <span className="tabular-nums">
                {label} · {chosen.length}
              </span>
            )}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t("docs.filter.searchLabels")} />
          <CommandList>
            <CommandEmpty>{t("docs.filter.noLabels")}</CommandEmpty>
            <CommandGroup>
              {tags.map((x) => (
                <CommandItem key={x.id} value={`${x.name} ${x.id}`} onSelect={() => toggle(x.id)}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: x.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {x.isInbox && <Inbox className="size-3.5 text-muted-foreground" aria-hidden />}
                  <Check className={cn("size-3.5", value.includes(x.id) ? "opacity-100" : "opacity-0")} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && <div className="border-t p-2">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const NONE = "__none"

/** Correspondent or type: one of the labels, or none. */
export function LabelSelect({
  labels,
  value,
  onChange,
  label,
  noneLabel,
  size = "default",
  className,
  id,
}: {
  labels: LabelView[]
  value: string | null
  onChange: (id: string | null) => void
  label: string
  noneLabel: string
  size?: "sm" | "default"
  className?: string
  id?: string
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size={size} className={cn("w-full", className)} aria-label={label} id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{noneLabel}</span>
        </SelectItem>
        {labels.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
