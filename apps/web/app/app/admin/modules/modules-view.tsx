"use client"
import { SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan, useCurrentUser } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { PageHeader } from "@/components/app/page-header"
import { StatusBadge } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"

type ModuleRow = FunctionReturnType<typeof api.system.listModules>[number]
type FlagRow = FunctionReturnType<typeof api.system.listFeatureFlags>[number]

function NameCell({ id, description }: { id: string; description: string }) {
  return (
    <div className="grid min-w-0 leading-tight">
      <span className="font-mono text-[13px] font-medium">{id}</span>
      <span className="truncate text-xs text-muted-foreground">{description}</span>
    </div>
  )
}

/** Module catalog. Only Super may switch business modules on or off. */
export function ModulesView() {
  const { t } = useT()
  const modules = useQuery(api.system.listModules, {})
  const canFlags = useCan(P.flagsRead)
  const canSetFlags = useCan(P.flagsUpdate)
  const flags = useQuery(api.system.listFeatureFlags, canFlags ? {} : "skip")
  const setEnabled = useMutation(api.system.setModuleEnabled)
  const setFlag = useMutation(api.system.setFeatureFlag)
  const isSuper = useCurrentUser()?.isSuper ?? false
  const { run, busy } = useAction()

  // Business modules first; they're the ones with a choice to make.
  const sorted = modules ? [...modules].sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "business" ? -1 : 1)) : undefined

  const columns: ColumnDef<ModuleRow>[] = [
    { accessorKey: "id", header: t("mod.module"), cell: ({ row }) => <NameCell id={row.original.id} description={row.original.description} />, meta: { className: "max-w-[28rem]" } },
    {
      accessorKey: "kind",
      header: t("mod.kind"),
      cell: ({ row }) =>
        row.original.kind === "business" ? <Badge variant="outline">{t("mod.kind.business")}</Badge> : <Badge variant="secondary">{t("mod.kind.system")}</Badge>,
    },
    {
      id: "enabled",
      header: t("mod.enabled"),
      cell: ({ row }) => {
        const m = row.original
        if (m.kind !== "business") return <span className="text-muted-foreground">{t("mod.enabled")}</span>
        const toggle = (
          <Switch
            checked={m.enabled}
            disabled={!isSuper || busy}
            aria-label={`${t("mod.enabled")}: ${m.id}`}
            onCheckedChange={(on) => void run(() => setEnabled({ moduleId: m.id, enabled: on }), { success: on ? t("mod.toggledOn") : t("mod.toggledOff") })}
          />
        )
        return isSuper ? (
          toggle
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{toggle}</span>
            </TooltipTrigger>
            <TooltipContent>{t("mod.superOnly")}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      accessorKey: "effective",
      header: t("mod.forYou"),
      cell: ({ row }) =>
        row.original.effective ? <StatusBadge tone="positive">{t("mod.available")}</StatusBadge> : <StatusBadge tone="ended">{t("mod.unavailable")}</StatusBadge>,
    },
  ]

  const flagColumns: ColumnDef<FlagRow>[] = [
    { accessorKey: "id", header: t("mod.flag"), cell: ({ row }) => <NameCell id={row.original.id} description={row.original.description} /> },
    {
      id: "value",
      header: t("mod.enabled"),
      meta: { align: "end" },
      cell: ({ row }) => (
        <Switch
          checked={row.original.value}
          disabled={!canSetFlags || busy}
          aria-label={`${t("mod.enabled")}: ${row.original.id}`}
          onCheckedChange={(on) => void run(() => setFlag({ flagId: row.original.id, value: on }), { success: on ? t("mod.flagOn") : t("mod.flagOff") })}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader title={t("mod.title")} lead={t("mod.lead")} />
      <DataTable label={t("mod.title")} rows={sorted} columns={columns} getRowId={(m) => m.id} />
      {canFlags && flags && flags.length > 0 && (
        <section className="mt-10">
          <h2 className="text-base font-semibold">{t("mod.flags")}</h2>
          <p className="mb-4 mt-1 max-w-[60ch] text-sm text-muted-foreground">{t("mod.flagsLead")}</p>
          <DataTable label={t("mod.flags")} rows={flags} columns={flagColumns} getRowId={(f) => f.id} />
        </section>
      )}
    </>
  )
}
