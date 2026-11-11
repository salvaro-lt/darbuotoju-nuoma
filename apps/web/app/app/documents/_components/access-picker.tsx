"use client"
import type { AccessOptions } from "@digimuza/documents"
import { useQuery } from "convex/react"
import { Plus, ShieldCheck, UserRound, UsersRound, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"

export interface Grants {
  userIds: string[]
  roleIds: string[]
}

/** Roles and active users to grant (for label managers and people who may share). */
export function useAccessOptions(enabled = true): AccessOptions | undefined {
  return useQuery(api.documents.getAccessOptions, enabled ? {} : "skip")
}

/** Who may see: roles and people, as removable chips with a searchable add menu each. */
export function AccessPicker({ value, onChange, options, disabled }: { value: Grants; onChange: (v: Grants) => void; options: AccessOptions | undefined; disabled?: boolean }) {
  const { t } = useT()
  if (!options)
    return (
      <div className="grid gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  return (
    <div className="grid gap-4">
      <GrantList
        label={t("docs.access.roles")}
        icon={<UsersRound className="size-3.5" aria-hidden />}
        add={t("docs.access.pickRoles")}
        search={t("docs.access.searchRoles")}
        items={options.roles.map((r) => ({ id: r.id, name: r.name }))}
        selected={value.roleIds}
        onChange={(roleIds) => onChange({ ...value, roleIds })}
        disabled={disabled}
      />
      <GrantList
        label={t("docs.access.users")}
        icon={<UserRound className="size-3.5" aria-hidden />}
        add={t("docs.access.pickUsers")}
        search={t("docs.access.searchUsers")}
        items={options.users.map((u) => ({ id: u.id, name: u.name, hint: u.email !== u.name ? u.email : undefined }))}
        selected={value.userIds}
        onChange={(userIds) => onChange({ ...value, userIds })}
        disabled={disabled}
      />
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        {t("docs.access.adminsAlways")}
      </p>
    </div>
  )
}

interface Item {
  id: string
  name: string
  hint?: string | undefined
}

function GrantList({
  label,
  icon,
  add,
  search,
  items,
  selected,
  onChange,
  disabled,
}: {
  label: string
  icon: React.ReactNode
  add: string
  search: string
  items: Item[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean | undefined
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const byId = new Map(items.map((i) => [i.id, i]))
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div role="group" aria-label={label} className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled}>
              <Plus />
              {add}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            <Command>
              <CommandInput placeholder={search} />
              <CommandList>
                <CommandEmpty>{t("docs.access.noMatch")}</CommandEmpty>
                <CommandGroup>
                  {items.map((i) => (
                    <CommandItem key={i.id} value={`${i.name} ${i.hint ?? ""} ${i.id}`} data-checked={selected.includes(i.id)} onSelect={() => toggle(i.id)}>
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate">{i.name}</span>
                        {i.hint && <span className="truncate text-xs text-muted-foreground">{i.hint}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const item = byId.get(id)
            return (
              <li key={id} className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border bg-muted/50 pr-0.5 pl-2 text-sm">
                <span className="truncate">{item?.name ?? t("docs.access.unknown")}</span>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`${t("docs.access.remove")}: ${item?.name ?? id}`} disabled={disabled} onClick={() => toggle(id)}>
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Names of granted roles and users, for read-only display. */
export function grantNames(options: AccessOptions | undefined, g: Grants): string[] {
  if (!options) return []
  const roles = new Map(options.roles.map((r) => [r.id, r.name]))
  const users = new Map(options.users.map((u) => [u.id, u.name]))
  return [...g.roleIds.map((id) => roles.get(id)), ...g.userIds.map((id) => users.get(id))].filter((x): x is string => Boolean(x))
}
