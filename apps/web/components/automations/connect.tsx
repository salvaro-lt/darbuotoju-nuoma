"use client"
// "Prijungimas": how messages reach an automation. Email (Resend): its own
// address. Webhook / form (and other email providers): the URL, the token
// (shown once, rotatable), an HTML form snippet and a curl example.
import { AutomationsPermissions, type AutomationView } from "@digimuza/system-core/automations"
import { useCan } from "@digimuza/system-core/react"
import { useAction as useConvexAction, useQuery } from "convex/react"
import { CheckCircle2, CircleAlert, KeyRound, Mail, RotateCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n/client"
import { AutomationInboxNote } from "@/components/ingest/inbox-picker"
import { useIngestEnabled } from "@/components/ingest/shared"
import { CodeBlock, CopyButton, CopyField, convexApi as api, dateTime, useSiteUrl } from "./shared"

export function ConnectPanel({ automation }: { automation: AutomationView }) {
  const resend = automation.trigger.channel === "email" && (automation.trigger.emailSource ?? "resend") === "resend"
  return resend ? <ResendSetup automation={automation} /> : <HookSetup automation={automation} />
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <span className={ok ? "text-muted-foreground" : ""}>{children}</span>
    </li>
  )
}

function ResendSetup({ automation }: { automation: AutomationView }) {
  const { t } = useT()
  const site = useSiteUrl()
  const setup = useQuery(api.automations.getInboundSetup, {})
  // With Gavimas (ingest) on, the inbox and the integration replace the env checklist.
  const ingest = useIngestEnabled()
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mail className="size-4" />
          </span>
          <div className="grid gap-1">
            <h2 className="font-semibold">{t("auto.connect.address")}</h2>
            <p className="text-sm text-muted-foreground">{t("auto.connect.forward")}</p>
          </div>
        </div>
        {automation.inboundAddress ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <CopyField value={automation.inboundAddress} />
            </div>
            <CopyButton value={automation.inboundAddress} label={t("auto.connect.copyAddress")} variant="default" />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{t("auto.connect.noAddress")}</p>
        )}
      </section>
      {ingest ? (
        <AutomationInboxNote inboxId={automation.trigger.inboxId} />
      ) : setup && (
        <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <h3 className="text-sm font-semibold">{t("auto.connect.setup")}</h3>
          <ul className="grid gap-2">
            <Check ok={!!setup.inboundDomain}>{setup.inboundDomain ? t("auto.connect.domainOk").replace("{domain}", setup.inboundDomain) : t("auto.connect.domainMissing")}</Check>
            <Check ok={setup.webhookSecretConfigured}>{t(setup.webhookSecretConfigured ? "auto.connect.secretOk" : "auto.connect.secretMissing")}</Check>
            <Check ok={setup.receivingKeyConfigured}>{t("auto.connect.keyHint")}</Check>
          </ul>
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">{t("auto.connect.resendWebhook")}</p>
            <CopyField value={`${site}${setup.resendWebhookPath}`} />
          </div>
        </section>
      )}
    </div>
  )
}

function HookSetup({ automation }: { automation: AutomationView }) {
  const { t, locale } = useT()
  const site = useSiteUrl()
  const canManage = useCan(AutomationsPermissions.manage)
  const rotate = useConvexAction(api.automations.rotateHookSecret)
  const { run, busy } = useAction()
  const [secret, setSecret] = useState<string | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const url = `${site}${automation.hook.path}`
  const email = automation.trigger.channel === "email"

  // The builder created the first token right after saving: show it here, once.
  useEffect(() => {
    const key = `automation-secret:${automation.id}`
    const timer = setTimeout(() => {
      const s = sessionStorage.getItem(key)
      if (!s) return
      sessionStorage.removeItem(key)
      setSecret(s)
      setShown(s)
    }, 0)
    return () => clearTimeout(timer)
  }, [automation.id])

  const token = shown ?? "ahk_…"
  const form = `<form action="${url}?token=${token}" method="post">
  <input type="hidden" name="form_id" value="contact">
  <label>${t("auto.snippet.name")} <input name="name" required></label>
  <label>${t("common.email")} <input name="email" type="email" required></label>
  <label>${t("auto.snippet.phone")} <input name="phone" type="tel"></label>
  <label>${t("auto.snippet.message")} <textarea name="message" required></textarea></label>
  <!-- ${t("auto.snippet.redirect")} -->
  <!-- <input type="hidden" name="redirect" value="https://example.com/aciu"> -->
  <button type="submit">${t("auto.snippet.send")}</button>
</form>`
  const curl = `curl -X POST "${url}" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jonas Jonaitis","email":"jonas@example.com","message":"${t("auto.snippet.sample")}"}'`

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
        <div className="grid gap-1.5">
          <h2 className="font-semibold">{t("auto.connect.url")}</h2>
          <CopyField value={url} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3">
          <div className="flex min-w-0 items-center gap-3">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">{t("auto.connect.token")}</p>
              <p className="truncate text-muted-foreground">
                {automation.hook.hasSecret
                  ? t("auto.connect.tokenSet").replace("{prefix}", automation.hook.prefix ?? "ahk_").replace("{date}", automation.hook.rotatedAt ? dateTime(automation.hook.rotatedAt, locale) : "—")
                  : t("auto.connect.tokenNone")}
              </p>
            </div>
          </div>
          {canManage && (
            <Button
              size="sm"
              variant={automation.hook.hasSecret ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                void run(() => rotate({ automationId: automation.id })).then((r) => {
                  if (r) {
                    setSecret(r.secret)
                    setShown(r.secret)
                  }
                })
              }
            >
              <RotateCw />
              {automation.hook.hasSecret ? t("auto.connect.rotate") : t("auto.connect.createToken")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("auto.connect.tokenWhere")}</p>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
        <h3 className="text-sm font-semibold">{email ? t("auto.connect.providers") : t("auto.connect.examples")}</h3>
        {email && <p className="text-sm text-muted-foreground">{t("auto.connect.providersBody")}</p>}
        <Tabs defaultValue={email ? "curl" : "form"}>
          <TabsList>
            {!email && <TabsTrigger value="form">{t("auto.connect.formSnippet")}</TabsTrigger>}
            <TabsTrigger value="curl">curl</TabsTrigger>
          </TabsList>
          {!email && (
            <TabsContent value="form" className="mt-3">
              <CodeBlock code={form} label="HTML" />
              <p className="mt-2 text-xs text-muted-foreground">{t("auto.connect.formNote")}</p>
            </TabsContent>
          )}
          <TabsContent value="curl" className="mt-3">
            <CodeBlock code={curl} label="Shell" />
          </TabsContent>
        </Tabs>
      </section>

      <Dialog open={!!secret}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("auto.secret.title")}</DialogTitle>
            <DialogDescription>{t("auto.secret.body")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code className="flex-1 break-all font-mono text-[13px]">{secret}</code>
            {secret && <CopyButton value={secret} />}
          </div>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{t("auto.secret.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
