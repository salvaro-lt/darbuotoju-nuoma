"use client"
import { systemErrorOf } from "@digimuza/system-core/react"
import { useState } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

/**
 * Runs a Convex call. Success: optional toast. Failure: a toast with the
 * stable error code's message and the operation ID (it links the failure to
 * the audit log and diagnostics); `error` may give a more specific message,
 * `onError` sees the code and invalid fields. Returns undefined on failure.
 */
export function useAction() {
  const { t } = useT()
  const [busy, setBusy] = useState(false)

  async function run<T>(fn: () => Promise<T>, opts: {
      success?: string
      onError?: (e: { code: string; fields: string[] }) => void
      error?: (se: ReturnType<typeof systemErrorOf>) => string | undefined
    } = {},): Promise<T | undefined> {
    setBusy(true)
    try {
      const res = await fn()
      if (opts.success) toast.success(opts.success)
      return res
    } catch (e) {
      const se = systemErrorOf(e)
      opts.onError?.({ code: se?.code ?? "UNKNOWN", fields: se?.fields ?? [] })
      toast.error(opts.error?.(se) ?? (se ? t(`error.${se.code}` as MessageKey) : t("error.unknown")), {
        description: se?.operationId ? `${t("state.operation")} ${se.operationId}` : undefined,
        duration: 8000,
      })
      return undefined
    } finally {
      setBusy(false)
    }
  }

  return { run, busy }
}
