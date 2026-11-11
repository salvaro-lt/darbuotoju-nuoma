"use client"
import type { ReactNode } from "react"
import { useT } from "@/lib/i18n/client"
import { useAutomationsEnabled } from "./shared"

/** Renders the page only while the module is on (it can be turned off live). */
export function AutomationsGate({ children }: { children: ReactNode }) {
  const { t } = useT()
  if (!useAutomationsEnabled()) return <p className="text-sm text-muted-foreground">{t("auto.disabled")}</p>
  return <>{children}</>
}
