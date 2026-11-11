"use client"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { OBJECT_ICONS, ObjectIcon } from "./icons"

export function IconPicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" size="icon" aria-label={`${t("crm.object.icon")}: ${value}`}>
          <ObjectIcon name={value} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="listbox" aria-label={t("crm.object.icon")} className="grid grid-cols-6 gap-1">
          {Object.keys(OBJECT_ICONS).map((name) => (
            <Button
              key={name}
              type="button"
              role="option"
              aria-selected={value === name}
              aria-label={name}
              variant="ghost"
              size="icon"
              className={cn(value === name && "bg-accent text-accent-foreground")}
              onClick={() => onChange(name)}
            >
              <ObjectIcon name={name} />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
