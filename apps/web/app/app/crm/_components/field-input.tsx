"use client"
import type { CrmFieldView } from "@digimuza/crm"
import { ratingScale, type CurrencyValue } from "@digimuza/crm/fields"
import { useQuery } from "convex/react"
import { Check, ChevronsUpDown, Star, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { OPTION_DOT, OptionBadge } from "./field-display"

/**
 * Editor for one field value. `value` is what the record stores (or a draft
 * the server accepts, e.g. a number typed as text); `onChange(null)` clears.
 * The server validates everything again: this only shapes the input.
 */
export function FieldInput({
  field,
  value,
  onChange,
  id,
  relationLabel,
  autoFocus,
  invalid,
}: {
  field: CrmFieldView
  value: unknown
  onChange: (v: unknown) => void
  id: string
  relationLabel?: string | undefined
  autoFocus?: boolean
  invalid?: boolean
}) {
  const s = field.settings
  const common = { id, autoFocus, "aria-invalid": invalid || undefined }
  const str = typeof value === "string" || typeof value === "number" ? String(value) : ""
  switch (field.type) {
    case "text":
      return <Input {...common} value={str} maxLength={s.maxLength ?? 500} onChange={(e) => onChange(e.target.value)} />
    case "longText":
      return <Textarea {...common} value={str} rows={4} onChange={(e) => onChange(e.target.value)} />
    case "email":
      return <Input {...common} type="email" autoComplete="off" value={str} onChange={(e) => onChange(e.target.value)} />
    case "phone":
      return <Input {...common} type="tel" autoComplete="off" value={str} onChange={(e) => onChange(e.target.value)} />
    case "url":
      return <Input {...common} type="text" inputMode="url" placeholder="https://" value={str} onChange={(e) => onChange(e.target.value)} />
    case "number":
      return (
        <Input
          {...common}
          inputMode="decimal"
          className="tabular-nums"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          {...(s.min !== undefined ? { "aria-valuemin": s.min } : {})}
          {...(s.max !== undefined ? { "aria-valuemax": s.max } : {})}
        />
      )
    case "currency":
      return <CurrencyInput {...common} field={field} value={value as CurrencyValue | undefined} onChange={onChange} />
    case "boolean":
      return <Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v)} />
    case "date":
      return <Input {...common} type="date" className="w-fit tabular-nums" value={str} onChange={(e) => onChange(e.target.value)} />
    case "dateTime":
      return (
        <Input
          {...common}
          type="datetime-local"
          className="w-fit tabular-nums"
          value={typeof value === "number" ? toLocalInput(value) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).getTime() : null)}
        />
      )
    case "select":
      return <SelectInput id={id} field={field} value={value as string | undefined} onChange={onChange} invalid={invalid} />
    case "multiSelect":
      return <MultiSelectInput id={id} field={field} value={(value as string[] | undefined) ?? []} onChange={onChange} />
    case "rating":
      return <RatingInput id={id} scale={ratingScale(s)} value={value as number | undefined} onChange={onChange} />
    case "relation":
      return <RecordPicker id={id} objectKey={s.objectKey ?? ""} value={value as string | undefined} label={relationLabel} onChange={onChange} invalid={invalid} />
  }
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function CurrencyInput({ field, value, onChange, id, autoFocus, ...rest }: { field: CrmFieldView; value: CurrencyValue | undefined; onChange: (v: unknown) => void; id: string; autoFocus?: boolean | undefined; "aria-invalid"?: boolean | undefined }) {
  const { t } = useT()
  const currency = value?.currency ?? field.settings.defaultCurrency ?? "EUR"
  const [text, setText] = useState(value ? (value.amount / 100).toFixed(2) : "")
  function update(next: string) {
    setText(next)
    if (!next.trim()) return onChange(null)
    const n = Number(next.replace(/\s/g, "").replace(",", "."))
    // Unparseable text is sent as-is so the server reports the field as invalid.
    onChange(Number.isFinite(n) ? { amount: Math.round(n * 100), currency } : { amount: Number.NaN, currency })
  }
  return (
    <div className="flex items-center gap-2">
      <Input id={id} autoFocus={autoFocus} {...rest} inputMode="decimal" className="tabular-nums" aria-label={`${field.label}, ${t("crm.amount")}`} value={text} onChange={(e) => update(e.target.value)} />
      <span className="w-10 shrink-0 text-sm text-muted-foreground tabular-nums">{currency}</span>
    </div>
  )
}

const CLEAR = "__clear__"

function SelectInput({ field, value, onChange, id, invalid }: { field: CrmFieldView; value: string | undefined; onChange: (v: unknown) => void; id: string; invalid?: boolean | undefined }) {
  const { t } = useT()
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v === CLEAR ? null : v)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={t("crm.pick")} />
      </SelectTrigger>
      <SelectContent>
        {(field.settings.options ?? []).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className={cn("size-2 rounded-full", OPTION_DOT[o.color])} aria-hidden />
            {o.label}
          </SelectItem>
        ))}
        {value && !field.required && (
          <SelectItem value={CLEAR} className="text-muted-foreground">
            {t("crm.clear")}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

function MultiSelectInput({ field, value, onChange, id }: { field: CrmFieldView; value: string[]; onChange: (v: unknown) => void; id: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const options = field.settings.options ?? []
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="h-auto min-h-8 w-full justify-between px-2.5 py-1 font-normal">
          <span className="flex flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{t("crm.pick")}</span>
            ) : (
              value.map((v) => {
                const o = options.find((x) => x.value === v)
                return <OptionBadge key={v} label={o?.label ?? v} color={o?.color ?? "gray"} />
              })
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("crm.search")} />
          <CommandList>
            <CommandEmpty>{t("crm.noResults")}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                  <span className={cn("size-2 rounded-full", OPTION_DOT[o.color])} aria-hidden />
                  {o.label}
                  <Check className={cn("ml-auto", value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function RatingInput({ scale, value, onChange, id }: { scale: number; value: number | undefined; onChange: (v: unknown) => void; id: string }) {
  const { t } = useT()
  return (
    <div id={id} role="radiogroup" className="flex items-center gap-0.5">
      {Array.from({ length: scale }, (_, i) => {
        const n = i + 1
        const on = (value ?? 0) >= n
        return (
          <Button key={n} type="button" variant="ghost" size="icon-sm" role="radio" aria-checked={value === n} aria-label={`${n} / ${scale}`} onClick={() => onChange(value === n ? null : n)}>
            <Star className={cn(on ? "fill-foreground text-foreground" : "text-muted-foreground")} />
          </Button>
        )
      })}
      {value !== undefined && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("crm.clear")} onClick={() => onChange(null)}>
          <X />
        </Button>
      )}
    </div>
  )
}

/** Picks one record of `objectKey`, searching by its title and text fields. */
export function RecordPicker({ objectKey, value, label, onChange, id, invalid }: { objectKey: string; value: string | undefined; label?: string | undefined; onChange: (v: unknown) => void; id: string; invalid?: boolean | undefined }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const results = useQuery(api.crm.searchRecords, open ? { objectKey, search } : "skip")
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)
  const shown = value ? (picked?.id === value ? picked.label : label) : undefined
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid || undefined} className="w-full min-w-0 flex-1 justify-between font-normal">
            <span className={cn("truncate", !shown && "text-muted-foreground")}>{shown ?? t("crm.pickRecord")}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          {/* The server searches; cmdk must not filter the results again. */}
          <Command shouldFilter={false}>
            <CommandInput placeholder={t("crm.pickRecord")} value={search} onValueChange={setSearch} />
            <CommandList>
              {results !== undefined && <CommandEmpty>{t("crm.noResults")}</CommandEmpty>}
              <CommandGroup>
                {(results ?? []).map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.id}
                    onSelect={() => {
                      setPicked({ id: r.id, label: r.label })
                      onChange(r.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{r.label || "…"}</span>
                    <Check className={cn("ml-auto", value === r.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button type="button" variant="ghost" size="icon" aria-label={t("crm.clear")} onClick={() => onChange(null)}>
          <X />
        </Button>
      )}
    </div>
  )
}
