"use client"
import type { CrmFieldView, CrmObjectView } from "@digimuza/crm"
import { CrmPermissions } from "@digimuza/crm/manifest"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

export function useCrmEnabled() {
  return useVisibleModules().some((m) => m.id === "crm" && m.effective)
}

/** The live data model. `undefined` while loading or when the module is off or not readable. */
export function useCrmSchema(includeArchived = false) {
  const enabled = useCrmEnabled()
  const canRead = useCan(CrmPermissions.read)
  const res = useQuery(api.crm.getCrmSchema, enabled && canRead ? { includeArchived } : "skip")
  return { enabled, objects: res?.objects }
}

export function useCrmObject(objectKey: string) {
  const { enabled, objects } = useCrmSchema()
  return { enabled, objects, object: objects?.find((o) => o.key === objectKey) ?? (objects ? null : undefined) }
}

export const fieldByKey = (object: CrmObjectView) => new Map<string, CrmFieldView>(object.fields.map((f) => [f.key, f]))

export const recordHref = (objectKey: string, id: string) => `/app/crm/${objectKey}/${id}`
