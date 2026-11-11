"use client"
import { auditModuleOf } from "@digimuza/system-core/audit"
import { Check, ChevronDown, ChevronsUpDown, KeyRound, Search, X } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { DEFAULT_RANGE, isFiltered, localDate, RANGES, RESULTS, type AuditResult, type AuditUrlFilter, type RangePreset, type SearchScope } from "./filters"
import { moduleLabel, type Lookup } from "./labels"
import { useNow } from "./time"

const ANY = "__any"

export interface PersonOption {
  id: string
  name: string
  email?: string
}

interface Props {
  filter: AuditUrlFilter
  onChange: (next: AuditUrlFilter) => void
  people: PersonOption[] | undefined
  facets: { actions: string[]; moduleIds: string[]; complete: boolean } | undefined
  tr: Lookup
  label: (action: string) => string
}

/** Filter bar of the audit log. Every change goes to the URL through `onChange`. */
export function AuditFilters({ filter, onChange, people, facets, tr, label }: Props) {
  const { t } = useT()
  const set = (patch: Partial<AuditUrlFilter>) => onChange({ ...filter, ...patch })
  const actions = (facets?.actions ?? []).filter((a) => !filter.module || auditModuleOf(a) === filter.module)

  return (
    <div role="search" aria-label={t("audit.filter.label")} className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <RangeControl filter={filter} onChange={onChange} />
        {people !== undefined && (
          <Combobox
            label={t("audit.filter.person")}
            anyLabel={t("audit.filter.anyPerson")}
            searchLabel={t("audit.filter.personSearch")}
            value={filter.actor}
            valueLabel={people.find((p) => p.id === filter.actor)?.name ?? filter.actor}
            options={people.map((p) => ({ value: p.id, label: p.name, hint: p.email !== p.name ? p.email : undefined, keywords: [p.email ?? ""] }))}
            onChange={(actor) => set({ actor })}
          />
        )}
        <Select value={filter.module ?? ANY} onValueChange={(v) => set({ module: v === ANY ? undefined : v, action: undefined })}>
          <SelectTrigger aria-label={t("audit.filter.module")} className={cn("w-44", !filter.module && "text-muted-foreground")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("audit.filter.anyModule")}</SelectItem>
            {[...new Set([...(facets?.moduleIds ?? []), ...(filter.module ? [filter.module] : [])])].map((m) => (
              <SelectItem key={m} value={m}>
                {moduleLabel(tr, m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Combobox
          label={t("audit.filter.action")}
          anyLabel={t("audit.filter.anyAction")}
          searchLabel={t("audit.filter.actionSearch")}
          value={filter.action}
          valueLabel={filter.action ? label(filter.action) : undefined}
          options={actions.map((a) => ({ value: a, label: label(a), hint: a, keywords: [a] }))}
          footer={facets && !facets.complete ? t("audit.filter.partial") : undefined}
          onChange={(action) => set({ action })}
          wide
        />
        <Select value={filter.result ?? ANY} onValueChange={(v) => set({ result: v === ANY ? undefined : (v as AuditResult) })}>
          <SelectTrigger aria-label={t("audit.filter.result")} className={cn("w-36", !filter.result && "text-muted-foreground")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("audit.filter.anyResult")}</SelectItem>
            {RESULTS.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`audit.result.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IdSearch key={`${filter.op ?? ""}|${filter.target ?? ""}`} filter={filter} onChange={onChange} />
      </div>
      {(filter.key || isFiltered(filter)) && (
        <div className="flex flex-wrap items-center gap-2">
          {filter.key && (
            <Badge variant="outline" className="h-7 gap-1.5 pr-1 font-normal">
              <KeyRound className="text-muted-foreground" />
              {t("audit.filter.apiKey")}
              <span className="font-mono text-xs">{filter.key}</span>
              <Button size="icon-xs" variant="ghost" aria-label={t("audit.filter.remove")} onClick={() => set({ key: undefined })}>
                <X />
              </Button>
            </Badge>
          )}
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onChange({ range: DEFAULT_RANGE })}>
            <X />
            {t("audit.filter.clear")}
          </Button>
        </div>
      )}
    </div>
  )
}

function RangeControl({ filter, onChange }: { filter: AuditUrlFilter; onChange: (f: AuditUrlFilter) => void }) {
  const { t } = useT()
  const today = localDate(useNow())
  return (
    <>
      <Select
        value={filter.range}
        onValueChange={(v) => {
          const range = v as RangePreset
          // Custom starts from the last 7 days so the inputs aren't empty.
          onChange(range === "custom" ? { ...filter, range, from: filter.from ?? localDate(Date.now() - 6 * 864e5), to: filter.to ?? today } : { ...filter, range, from: undefined, to: undefined })
        }}
      >
        <SelectTrigger aria-label={t("audit.range")} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r} value={r}>
              {t(`audit.range.${r}` as MessageKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filter.range === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label={t("audit.range.from")} className="w-38 tabular-nums" value={filter.from ?? ""} max={filter.to ?? today} onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })} />
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <Input type="date" aria-label={t("audit.range.to")} className="w-38 tabular-nums" value={filter.to ?? ""} min={filter.from} max={today} onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })} />
        </div>
      )}
    </>
  )
}

interface Option {
  value: string
  label: string
  hint?: string
  keywords?: string[]
}

/** Searchable single choice (Popover + Command) with an "any" first item. */
function Combobox({ label, anyLabel, searchLabel, value, valueLabel, options, onChange, footer, wide }: { label: string; anyLabel: string; searchLabel: string; value?: string; valueLabel?: string; options: Option[]; onChange: (v: string | undefined) => void; footer?: ReactNode; wide?: boolean }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const pick = (v: string | undefined) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label={label} className={cn("justify-between font-normal", wide ? "w-60" : "w-48", !value && "text-muted-foreground")}>
          <span className="truncate">{value ? valueLabel : anyLabel}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-0", wide ? "w-80" : "w-72")}>
        <Command>
          <CommandInput placeholder={searchLabel} />
          <CommandList>
            <CommandEmpty>{t("audit.filter.noMatch")}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__any ${anyLabel}`} onSelect={() => pick(undefined)}>
                <Check className={cn(value ? "opacity-0" : "opacity-100")} />
                {anyLabel}
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.value}`} keywords={o.keywords} onSelect={() => pick(o.value)}>
                  <Check className={cn(value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="truncate font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{footer}</p>}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Exact operation or target ID; applied on Enter (IDs don't match partially). */
function IdSearch({ filter, onChange }: { filter: AuditUrlFilter; onChange: (f: AuditUrlFilter) => void }) {
  const { t } = useT()
  const [scope, setScope] = useState<SearchScope>(filter.target && !filter.op ? "target" : "op")
  const [text, setText] = useState(filter.op ?? filter.target ?? "")
  const applied = filter.op ?? filter.target
  const apply = (value: string) => {
    const v = value.trim() || undefined
    onChange({ ...filter, op: scope === "op" ? v : undefined, target: scope === "target" ? v : undefined })
  }
  return (
    <form
      className="min-w-64 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        apply(text)
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" aria-label={`${t("audit.filter.scope")}: ${t(`audit.filter.scope.${scope}`)}`} className="text-muted-foreground">
                <Search />
                {t(`audit.filter.scope.${scope}`)}
                <ChevronDown />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t("audit.filter.scope")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={scope} onValueChange={(v) => setScope(v as SearchScope)}>
                <DropdownMenuRadioItem value="op">{t("audit.filter.scope.op")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="target">{t("audit.filter.scope.target")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </InputGroupAddon>
        <InputGroupInput
          aria-label={t(`audit.filter.placeholder.${scope}`)}
          placeholder={t(`audit.filter.placeholder.${scope}`)}
          className="font-mono text-xs placeholder:font-sans placeholder:text-sm"
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {(text || applied) && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={t("audit.filter.clearSearch")}
              onClick={() => {
                setText("")
                if (applied) apply("")
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </form>
  )
}
