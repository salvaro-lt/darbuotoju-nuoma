"use client"
import { Check, Copy } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n/client"

/** Icon button that copies `value`; the icon turns into a check for a moment. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const name = label ? `${t("common.copy")}: ${label}` : t("common.copy")

  async function copy(e: React.MouseEvent) {
    // Copying inside a clickable row must not open the row.
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (permissions, insecure context): the value stays selectable.
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-foreground" aria-label={name} onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? t("common.copied") : name}</TooltipContent>
    </Tooltip>
  )
}
