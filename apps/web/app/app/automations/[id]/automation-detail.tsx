"use client"
import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { useCan, useCurrentUser } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { AlertTriangle, ArrowLeft, Archive, MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { AutomationBuilder, draftOf, Summary } from "@/components/automations/builder"
import { ConnectPanel } from "@/components/automations/connect"
import { AutomationFlowTab } from "@/components/automations/flow/flow-tab"
import { RunsList } from "@/components/automations/runs"
import { ChannelIcon, convexApi as api, dateTime } from "@/components/automations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AutomationDetailSkeleton } from "@/components/app/skeletons"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n/client"

export function AutomationDetail({ id }: { id: string }) {
  const { t, locale } = useT()
  const router = useRouter()
  const data = useQuery(api.automations.getAutomation, { automationId: id })
  const me = useCurrentUser()
  const canManage = useCan(AutomationsPermissions.manage)
  const setEnabled = useMutation(api.automations.setAutomationEnabled)
  const archive = useMutation(api.automations.archiveAutomation)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState("diagram")
  const [confirmArchive, setConfirmArchive] = useState(false)

  if (data === undefined) return <AutomationDetailSkeleton />
  const a = data.automation

  return (
    <div className="animate-fade-in">
      <Link href="/app/automations" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("auto.nav.list")}
      </Link>
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <ChannelIcon channel={a.trigger.channel} className="size-11" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{a.name}</h1>
          {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant={a.enabled ? "default" : "outline"}>{a.enabled ? t("auto.on") : t("auto.off")}</Badge>
            <Badge variant="secondary">{t(a.mode === "auto" ? "auto.mode.auto" : "auto.mode.review")}</Badge>
            <span>
              v{a.version} · {t("auto.detail.owner")}: {a.owner.name ?? a.owner.email ?? a.owner.id}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={a.enabled} disabled={busy} onCheckedChange={(v) => void run(() => setEnabled({ automationId: a.id, enabled: v }), { success: v ? t("auto.enabled") : t("auto.disabledToast") })} />
              {a.enabled ? t("auto.on") : t("auto.off")}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("common.actions")}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmArchive(true)}>
                  <Archive />
                  {t("auto.archive")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      {a.problems.length > 0 && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{t("auto.detail.problems")}</p>
            <ul className="list-disc pl-5 text-[13px]">
              {a.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="diagram">{t("auto.detail.diagram")}</TabsTrigger>
          <TabsTrigger value="connect">{t("auto.detail.connect")}</TabsTrigger>
          <TabsTrigger value="settings">{t("auto.detail.settings")}</TabsTrigger>
          <TabsTrigger value="runs">{t("auto.detail.runs")}</TabsTrigger>
          <TabsTrigger value="versions">{t("auto.detail.versions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="diagram">
          <AutomationFlowTab
            automation={a}
            canManage={canManage}
            onEdit={() => {
              setTab("settings")
              setEditing(true)
            }}
          />
        </TabsContent>
        <TabsContent value="connect">
          <ConnectPanel automation={a} />
        </TabsContent>
        <TabsContent value="settings">
          {editing ? (
            <AutomationBuilder initial={draftOf(a)} automationId={a.id} ownerIsMe={!me || me.userId === a.owner.id} />
          ) : (
            <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
              <Summary draft={a} />
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{t("auto.extract.instructions")}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{a.extract.instructions}</p>
              </div>
              {canManage && (
                <Button className="justify-self-start" variant="outline" onClick={() => setEditing(true)}>
                  {t("auto.detail.edit")}
                </Button>
              )}
            </section>
          )}
        </TabsContent>
        <TabsContent value="runs">
          <RunsList automationId={a.id} compact />
        </TabsContent>
        <TabsContent value="versions">
          {data.versions.length === 0 ? (
            <EmptyState icon={<Archive />} title={t("auto.detail.noVersions")} />
          ) : (
            <ol className="divide-y overflow-hidden rounded-xl border bg-card">
              {data.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-muted-foreground">{dateTime(v.createdAt, locale)}</span>
                  {v.version === a.version && <Badge>{t("auto.detail.current")}</Badge>}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auto.archiveTitle")}</DialogTitle>
            <DialogDescription>{t("auto.archiveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                const res = await run(() => archive({ automationId: a.id }), { success: t("auto.archived") })
                if (res) router.push("/app/automations")
              }}
            >
              {t("auto.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
