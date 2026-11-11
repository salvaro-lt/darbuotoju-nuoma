"use client"
import { SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { AppWindow, ArrowRight, Contact, KeyRound, Mail, Receipt, ShieldAlert, Users } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { PageHeader } from "@/components/app/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { FinancePermissions } from "@digimuza/system-core/finance"
import { CrmPermissions } from "@digimuza/crm/manifest"

type TileDef = { href: string; icon: ReactNode; title: MessageKey; body: MessageKey; show: boolean }

export function DashboardView({ name, isSuper, permissions, financeEnabled, denied }: { name: string | null; isSuper: boolean; permissions: number; financeEnabled: boolean; denied: boolean }) {
  const { t } = useT()
  const financeOn = useVisibleModules().some((m) => m.id === "finance" && m.effective)
  const canFinance = useCan(FinancePermissions.read)
  const crmOn = useVisibleModules().some((m) => m.id === "crm" && m.effective)
  const canCrm = useCan(CrmPermissions.read)
  const canUsers = useCan(P.usersRead)
  const canInvites = useCan(P.invitesRead)
  const canModules = useCan(P.modulesRead)
  const canKeys = useCan(P.ownKeysRead)
  const tiles: TileDef[] = [
    { href: "/app/finance", icon: <Receipt />, title: "fin.title", body: "fin.lead", show: financeOn && canFinance },
    { href: "/app/crm", icon: <Contact />, title: "crm.title", body: "crm.dashLead", show: crmOn && canCrm },
    { href: "/app/admin/users", icon: <Users />, title: "users.title", body: "users.lead", show: canUsers },
    { href: "/app/admin/invites", icon: <Mail />, title: "inv.title", body: "inv.lead", show: canInvites },
    { href: "/app/admin/modules", icon: <AppWindow />, title: "mod.title", body: "mod.flagsLead", show: canModules },
    { href: "/app/settings/api-keys", icon: <KeyRound />, title: "keys.title", body: "keys.empty.body", show: canKeys },
  ]

  return (
    <>
      <PageHeader title={name ? `${t("dash.greeting")}, ${name}` : t("dash.greeting")} lead={t("dash.lead")} />
      <div className="grid gap-6">
        {denied && (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>{t("dash.denied")}</AlertTitle>
          </Alert>
        )}
        {isSuper && !financeEnabled && (
          <Alert>
            <AppWindow />
            <AlertTitle>{t("dash.financeOff.title")}</AlertTitle>
            <AlertDescription>
              <p>{t("dash.financeOff.body")}</p>
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link href="/app/admin/modules">{t("dash.financeOff.action")}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles
            .filter((x) => x.show)
            .map((x) => (
              <Link key={x.href} href={x.href} className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                <Card className="h-full transition-colors group-hover:bg-accent">
                  <CardHeader>
                    <span className="mb-2 inline-grid size-9 place-items-center rounded-lg bg-muted text-foreground [&_svg]:size-4.5">{x.icon}</span>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {t(x.title)}
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </CardTitle>
                    <CardDescription>{t(x.body)}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("dash.access")}: {isSuper ? "Super · " : ""}
          {permissions} {t("dash.permissions")}
        </p>
      </div>
    </>
  )
}
