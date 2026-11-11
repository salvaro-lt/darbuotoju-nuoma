"use client"
import type { RequirementView } from "@digimuza/staffing"
import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ListChecks, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { NativeSelect, useCertificateTypes } from "../../staffing/_components/staffing-ui"
import { ComplianceDisabled, ComplianceTabs, useComplianceEnabled } from "./compliance-ui"

export function RequirementsView() {
  const { t, locale } = useT()
  const on = useComplianceEnabled()
  const rows = useQuery(api.compliance.listRequirements, on ? {} : "skip")
  const del = useMutation(api.compliance.deleteRequirement)
  const { run, busy } = useAction()
  if (!on) return <ComplianceDisabled />

  const groups = new Map<string, RequirementView[]>()
  for (const r of rows ?? []) {
    const key = r.country ? `${t("compliance.requirements.country")}: ${r.country}` : `${t("compliance.requirements.client")}: ${r.clientName ?? "?"}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  return (
    <div>
      <PageHeader title={t("compliance.requirements.title")} lead={t("compliance.requirements.lead")} />
      <ComplianceTabs />
      <Can permission={StaffingCompliancePermissions.requirementManage}>
        <AddRequirement />
      </Can>
      {rows === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ListChecks />} title={t("compliance.requirements.empty")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...groups.entries()].map(([group, list]) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {list.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div>{locale === "en" ? (r.typeNameEn ?? r.typeName) : r.typeName}</div>
                        {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                      </div>
                      {r.scope === "nonEea" && <Badge variant="outline">{t("compliance.readiness.nonEea")}</Badge>}
                      <Can permission={StaffingCompliancePermissions.requirementManage}>
                        <Button size="icon" variant="ghost" disabled={busy} aria-label={t("staffing.common.delete")} onClick={() => run(() => del({ requirementId: r.id as Id<"staffing_compliance_requirements"> }), { success: t("staffing.common.deleted") })}>
                          <Trash2 />
                        </Button>
                      </Can>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function AddRequirement() {
  const { t, locale } = useT()
  const types = useCertificateTypes() ?? []
  const canClients = useCan(StaffingPermissions.clientRead)
  const clients = useQuery(api.staffing.listClients, canClients ? {} : "skip")
  const add = useMutation(api.compliance.addRequirement)
  const { run, busy } = useAction()
  const [target, setTarget] = useState<"country" | "client">("country")
  const [country, setCountry] = useState("")
  const [clientId, setClientId] = useState("")
  const [typeId, setTypeId] = useState("")
  const [scope, setScope] = useState<"all" | "nonEea">("all")
  const [note, setNote] = useState("")
  const ready = typeId && (target === "country" ? country.trim().length === 2 : clientId)
  return (
    <div className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border p-3">
      <NativeSelect aria-label={t("compliance.requirements.for")} value={target} onChange={(v) => setTarget(v as "country" | "client")}>
        <option value="country">{t("compliance.requirements.country")}</option>
        <option value="client">{t("compliance.requirements.client")}</option>
      </NativeSelect>
      {target === "country" ? (
        <Input className="w-24 uppercase" maxLength={2} placeholder={t("compliance.requirements.countryPlaceholder")} aria-label={t("compliance.requirements.country")} value={country} onChange={(e) => setCountry(e.target.value)} />
      ) : (
        <NativeSelect aria-label={t("compliance.requirements.client")} value={clientId} onChange={setClientId}>
          <option value="">—</option>
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      )}
      <NativeSelect aria-label={t("compliance.requirements.document")} value={typeId} onChange={setTypeId}>
        <option value="">{t("compliance.requirements.document")}</option>
        {types.map((ct) => (
          <option key={ct.id} value={ct.id}>
            {locale === "en" ? (ct.nameEn ?? ct.name) : ct.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("compliance.requirements.scope")} value={scope} onChange={(v) => setScope(v as "all" | "nonEea")}>
        <option value="all">{t("compliance.requirements.scopeAll")}</option>
        <option value="nonEea">{t("compliance.requirements.scopeNonEea")}</option>
      </NativeSelect>
      <Input className="w-56" placeholder={t("compliance.requirements.note")} aria-label={t("compliance.requirements.note")} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button
        size="sm"
        disabled={!ready || busy}
        onClick={async () => {
          const r = await run(
            () =>
              add({
                certificateTypeId: typeId as Id<"staffing_certificateTypes">,
                scope,
                ...(target === "country" ? { country } : { clientId: clientId as Id<"staffing_clients"> }),
                ...(note.trim() ? { note } : {}),
              }),
            { success: t("staffing.common.created") },
          )
          if (r) {
            setTypeId("")
            setNote("")
          }
        }}
      >
        <Plus />
        {t("compliance.requirements.add")}
      </Button>
    </div>
  )
}
