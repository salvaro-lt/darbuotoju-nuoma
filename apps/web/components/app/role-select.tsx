"use client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Role picker used by invites and role assignment. */
export function RoleSelect({ id, roles, value, onChange, placeholder }: { id: string; roles: { key: string; name: string }[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r.key} value={r.key}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
