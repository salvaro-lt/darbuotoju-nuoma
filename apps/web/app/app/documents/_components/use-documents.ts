"use client"
import type { DocumentsLabels } from "@digimuza/documents"
import { DocumentsFlags, DocumentsPermissions, DOCUMENTS_MODULE_ID } from "@digimuza/documents/manifest"
import { useCan, useFeatureFlag, useVisibleModules } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

export function useDocumentsEnabled() {
  return useVisibleModules().some((m) => m.id === DOCUMENTS_MODULE_ID && m.effective)
}

/** Signing is on (module + flag) and this user may see it. */
export function useSigningVisible() {
  const enabled = useDocumentsEnabled()
  const flag = useFeatureFlag(DocumentsFlags.signing)
  const can = useCan(DocumentsPermissions.signingRead)
  return enabled && flag && can
}

/** Tags, correspondents, types, custom fields and saved views. `undefined` while loading or when not readable. */
export function useLabels(): DocumentsLabels | undefined {
  const enabled = useDocumentsEnabled()
  const canRead = useCan(DocumentsPermissions.read)
  return useQuery(api.documents.getLabels, enabled && canRead ? {} : "skip")
}

export const documentHref = (id: string) => `/app/documents/${id}`
export const templateHref = (id: string) => `/app/documents/templates/${id}`
export const submissionHref = (id: string) => `/app/documents/signing/${id}`

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
