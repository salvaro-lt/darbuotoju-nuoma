"use client"
// Gavimas → Integracijos: the Resend card. Everything here is read from Convex
// (getIntegration) and refreshed live; the key itself never reaches the browser.
import { IngestPermissions, type IntegrationView } from "@digimuza/system-core/ingest"
import { useCan } from "@digimuza/system-core/react"
import { useAction as useConvexAction, useMutation, useQuery } from "convex/react"
import { Activity, Globe, KeyRound, MailCheck, RefreshCw, Send, Sparkles, Webhook } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/app/page-header"
import { StackSkeleton } from "@/components/app/skeletons"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { convexApi as api, CopyButton, CopyField, dateTime, fill, HealthBadge, Panel, relativeTime, StatusLine } from "./shared"

const POLL_MS = 20_000

export function IntegrationPage() {
  const { t, locale } = useT()
  const view = useQuery(api.ingest.getIntegration, {})
  const canSetup = useCan(IngestPermissions.integration)
  const refresh = useConvexAction(api.ingest.refreshIntegration)
  const runSetup = useConvexAction(api.ingest.runSetup)
  const { run, busy } = useAction()
  const [checking, setChecking] = useState(false)

  // One live look at Resend when the page opens (key, domains, this site's webhook).
  const asked = useRef(false)
  useEffect(() => {
    if (!view || asked.current) return
    asked.current = true
    if (view.keyConfigured && (!view.snapshot || Date.now() - view.snapshot.checkedAt > 60_000)) void refresh({}).catch(() => {})
  }, [view, refresh])

  const check = async () => {
    setChecking(true)
    await run(() => refresh({}))
    setChecking(false)
  }

  const setup = () =>
    void run(() => runSetup({})).then((r) => {
      if (!r) return
      if (r.ok) toast.success(t("ingest.setup.done"))
      else toast.warning(t("ingest.setup.partly"))
    })

  const setupButton = canSetup && view && (
    <Button onClick={setup} disabled={busy || !view.keyConfigured}>
      <Sparkles className={cn(busy && "animate-pulse motion-reduce:animate-none")} />
      {busy ? t("ingest.setup.running") : view.webhook.secretStored ? t("ingest.setup.again") : t("ingest.setup.button")}
    </Button>
  )

  return (
    <>
      <PageHeader title={t("ingest.int.title")} lead={t("ingest.int.lead")} actions={setupButton || undefined} />
      {view === undefined ? (
        <StackSkeleton count={3} item="h-40" className="grid gap-4" />
      ) : (
        <div className="grid animate-fade-in gap-4">
          <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
              <MailCheck className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{t("ingest.resend.title")}</h2>
                <HealthBadge health={view.health} />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("ingest.resend.sub")}
                {view.snapshot && <> · {fill(t("ingest.checked"), { when: relativeTime(view.snapshot.checkedAt, locale) })}</>}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking || !view.keyConfigured}>
              <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} />
              {t("ingest.check")}
            </Button>
            {canSetup && <p className="basis-full text-xs text-muted-foreground">{t("ingest.setup.hint")}</p>}
          </section>

          <SetupSteps view={view} />

          <div className="grid gap-4 lg:grid-cols-2">
            <KeyPanel view={view} />
            <WebhookPanel view={view} />
          </div>
          <DomainPanel view={view} canSetup={canSetup} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel icon={<Activity />} title={t("ingest.events.title")}>
              {view.lastEvent ? (
                <StatusLine state="ok">
                  <span className="text-foreground">{fill(t("ingest.events.at"), { type: view.lastEvent.type, when: relativeTime(view.lastEvent.at, locale) })}</span>
                  <span className="block text-xs">{dateTime(view.lastEvent.at, locale)}</span>
                </StatusLine>
              ) : (
                <StatusLine state="idle">{t("ingest.events.none")}</StatusLine>
              )}
            </Panel>
            <TestPanel view={view} canSetup={canSetup} />
          </div>
        </div>
      )}
    </>
  )
}

/** The last setup's steps (saved by the setup itself, so they update live). */
function SetupSteps({ view }: { view: IntegrationView }) {
  const { t, locale } = useT()
  const steps = view.lastSetup?.steps
  if (!steps?.length) return null
  const at = view.lastSetup!.at
  return (
    <section aria-live="polite" className="grid gap-2 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <p className="text-xs text-muted-foreground">{fill(t("ingest.setup.last"), { when: relativeTime(at, locale) })}</p>
      <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.step}>
            <StatusLine state={s.ok ? "ok" : "warn"}>
              <span className="font-medium text-foreground">{t(`ingest.step.${s.step}` as MessageKey)}</span>
              {!s.ok && s.code && <span className="block text-xs text-muted-foreground">{label(t, `ingest.code.${s.code}`, s.code)}</span>}
            </StatusLine>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A translated label for a code from Resend or the setup, else the code itself. */
const label = (t: (k: MessageKey) => string, key: string, fallback: string) => t(key as MessageKey) || fallback

function KeyPanel({ view }: { view: IntegrationView }) {
  const { t } = useT()
  const snap = view.snapshot
  const keyState = !view.keyConfigured ? "warn" : !snap ? "idle" : snap.keyOk ? "ok" : "warn"
  const keyText = !view.keyConfigured
    ? t("ingest.key.missing")
    : !snap
      ? t("ingest.key.unknown")
      : snap.keyOk
        ? t("ingest.key.ok")
        : snap.keyError === "key_restricted"
          ? t("ingest.key.restricted")
          : t("ingest.key.invalid")
  return (
    <Panel icon={<KeyRound />} title={t("ingest.key.title")}>
      <StatusLine state={keyState}>{keyText}</StatusLine>
      <p className="text-xs text-muted-foreground">{t("ingest.key.source")}</p>
      {snap?.keyOk && (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t("ingest.domains.title")}</p>
          {snap.domains.length ? (
            <ul className="grid gap-1.5">
              {snap.domains.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                  <Badge variant={d.status === "verified" ? "secondary" : "outline"}>{label(t, `ingest.dns.${d.status}`, d.status)}</Badge>
                  <Cap on={d.sending === "enabled"} label={t("ingest.domains.sending")} />
                  <Cap on={d.receiving === "enabled"} label={t("ingest.domains.receiving")} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ingest.domains.none")}</p>
          )}
        </div>
      )}
    </Panel>
  )
}

function Cap({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", on ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/50")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/40")} />
      {label}
    </span>
  )
}

function WebhookPanel({ view }: { view: IntegrationView }) {
  const { t, locale } = useT()
  const live = view.snapshot?.webhook
  return (
    <Panel icon={<Webhook />} title={t("ingest.webhook.title")}>
      {view.webhookUrl && (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">{t("ingest.webhook.url")}</p>
          <CopyField value={view.webhookUrl} />
        </div>
      )}
      <div className="grid gap-1.5">
        {view.siteNotPublic && <StatusLine state="warn">{fill(t("ingest.webhook.notPublic"), { site: view.siteUrl ?? "SITE_URL" })}</StatusLine>}
        {!view.encryptionConfigured && <StatusLine state="warn">{t("ingest.webhook.noEncryption")}</StatusLine>}
        {view.webhook.secretStored ? (
          live && live.status !== "enabled" ? (
            <StatusLine state="warn">{t("ingest.webhook.disabled")}</StatusLine>
          ) : (
            <StatusLine state="ok">{t("ingest.webhook.ok")}</StatusLine>
          )
        ) : view.webhook.envSecret ? (
          <StatusLine state="ok">{t("ingest.webhook.envOnly")}</StatusLine>
        ) : (
          <StatusLine state="warn">{t("ingest.webhook.none")}</StatusLine>
        )}
        {view.webhook.rotatedAt && <p className="pl-6 text-xs text-muted-foreground">{fill(t("ingest.webhook.rotated"), { when: dateTime(view.webhook.rotatedAt, locale) })}</p>}
        {!!view.snapshot?.staleWebhooks && <StatusLine state="warn">{fill(t("ingest.webhook.stale"), { n: view.snapshot.staleWebhooks })}</StatusLine>}
        {live && (
          <div className="flex flex-wrap gap-1.5 pl-6">
            {live.events.map((e) => (
              <Badge key={e} variant="outline" className="font-mono text-[11px]">
                {e}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

function DomainPanel({ view, canSetup }: { view: IntegrationView; canSetup: boolean }) {
  const { t } = useT()
  const r = view.receiving
  const refresh = useConvexAction(api.ingest.refreshReceivingDomain)
  const [verifying, setVerifying] = useState(false)
  const pending = r.source === "custom" && !r.verified

  // Poll Resend while DNS is pending and the tab is visible.
  useEffect(() => {
    if (!pending) return
    const tick = () => {
      if (document.visibilityState === "visible") void refresh({}).catch(() => {})
    }
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [pending, refresh])

  return (
    <Panel
      icon={<Globe />}
      title={t("ingest.domain.title")}
      actions={
        pending && canSetup ? (
          <Button
            size="sm"
            variant="outline"
            disabled={verifying}
            onClick={async () => {
              setVerifying(true)
              await refresh({ verify: true }).catch(() => {})
              setVerifying(false)
            }}
          >
            <RefreshCw className={cn(verifying && "animate-spin motion-reduce:animate-none")} />
            {t("ingest.domain.verifyNow")}
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-muted-foreground">{t("ingest.domain.lead")}</p>
      {r.domain ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm">{r.domain}</code>
          {r.source && <Badge variant="secondary">{t(`ingest.domain.source.${r.source}` as MessageKey)}</Badge>}
          <Badge variant={r.verified ? "default" : "outline"} className={cn(!r.verified && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
            {r.verified ? t("ingest.domain.verified") : t("ingest.domain.pending")}
          </Badge>
          {pending && <span className="text-xs text-muted-foreground">{t("ingest.domain.polling")}</span>}
        </div>
      ) : (
        <div className="grid gap-1 rounded-lg border border-dashed p-3">
          <StatusLine state="warn">
            <span className="font-medium text-foreground">{t("ingest.domain.none")}</span>
          </StatusLine>
          <p className="pl-6 text-sm text-muted-foreground">{t("ingest.domain.noneBody")}</p>
        </div>
      )}
      {r.records.length > 0 && !r.verified && <DnsRecords records={r.records} zone={r.zone} />}
      {!r.domain && canSetup && view.snapshot?.keyOk && <EnableSubdomain suggestion={r.suggestion} />}
    </Panel>
  )
}

function DnsRecords({ records, zone }: { records: IntegrationView["receiving"]["records"]; zone: string | null }) {
  const { t } = useT()
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t("ingest.domain.records")}</p>
      {zone && <p className="text-xs text-muted-foreground">{fill(t("ingest.domain.zone"), { zone })}</p>}
      <ul className="grid gap-2">
        {records.map((rec) => (
          <li key={`${rec.type}-${rec.name}`} className="grid gap-2 rounded-lg border bg-background p-3 text-sm sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center">
            <div className="flex items-center gap-2 sm:block">
              <Badge variant="outline" className="font-mono">
                {rec.type}
              </Badge>
              {rec.priority !== undefined && (
                <span className="text-xs text-muted-foreground sm:mt-1 sm:block">
                  {t("ingest.domain.record.priority")} {rec.priority}
                </span>
              )}
            </div>
            <CopyCell label={t("ingest.domain.record.name")} value={rec.name} />
            <CopyCell label={t("ingest.domain.record.value")} value={rec.value} />
            <Badge variant={rec.status === "verified" ? "default" : "outline"} className="justify-self-start">
              {label(t, `ingest.dns.${rec.status}`, rec.status)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CopyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <code className="block truncate text-[13px]" title={value}>
          {value}
        </code>
      </div>
      <CopyButton value={value} variant="ghost" />
    </div>
  )
}

function EnableSubdomain({ suggestion }: { suggestion: string | null }) {
  const { t } = useT()
  const enable = useConvexAction(api.ingest.enableReceivingSubdomain)
  const setManaged = useMutation(api.ingest.setManagedDomain)
  const { run, busy } = useAction()
  const [name, setName] = useState(suggestion ?? "")
  const [managed, setManagedValue] = useState("")
  return (
    <div className="grid gap-4 border-t pt-4">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => enable({ name })).then((r) => {
            if (!r) return
            if (r.ok) toast.success(t("ingest.domain.enabled"))
            else toast.error(t(`ingest.domain.error.${r.code}` as MessageKey) || fill(t("ingest.domain.error.generic"), { code: r.code }))
          })
        }}
      >
        <label htmlFor="ingest-subdomain" className="text-sm font-medium">
          {t("ingest.domain.subdomain")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="ingest-subdomain" value={name} onChange={(e) => setName(e.target.value)} placeholder="in.example.com" className="font-mono sm:max-w-sm" autoComplete="off" spellCheck={false} />
          <Button type="submit" disabled={busy || !name.trim()}>
            <Globe />
            {t("ingest.domain.enable")}
          </Button>
        </div>
      </form>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => setManaged({ domain: managed.trim() }), { success: t("ingest.domain.managedSaved") })
        }}
      >
        <label htmlFor="ingest-managed" className="text-sm font-medium">
          {t("ingest.domain.managed")}
        </label>
        <p className="text-xs text-muted-foreground">{t("ingest.domain.managedHint")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="ingest-managed" value={managed} onChange={(e) => setManagedValue(e.target.value)} placeholder="abc123.resend.app" className="font-mono sm:max-w-sm" autoComplete="off" spellCheck={false} />
          <Button type="submit" variant="outline" disabled={busy || !/\.resend\.app$/i.test(managed.trim())}>
            {t("ingest.domain.managedSave")}
          </Button>
        </div>
      </form>
    </div>
  )
}

function TestPanel({ view, canSetup }: { view: IntegrationView; canSetup: boolean }) {
  const { t, locale } = useT()
  const send = useConvexAction(api.ingest.sendTestEmail)
  const { run, busy } = useAction()
  const test = view.lastTest
  const ready = view.receiving.verified && !!view.receiving.domain && view.webhook.secretStored
  return (
    <Panel
      icon={<Send />}
      title={t("ingest.test.title")}
      actions={
        canSetup ? (
          <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => void run(() => send({})).then((r) => r && !r.sent && toast.error(fill(t("ingest.test.failed"), { code: r.error ?? "?" })))}>
            <Send />
            {t("ingest.test.send")}
          </Button>
        ) : undefined
      }
    >
      {!test ? (
        <StatusLine state="idle">{ready ? t("ingest.test.none") : t("ingest.test.needsDomain")}</StatusLine>
      ) : test.error ? (
        <StatusLine state="warn">{fill(t("ingest.test.failed"), { code: test.error })}</StatusLine>
      ) : test.receivedAt ? (
        <StatusLine state="ok">
          <span className="text-foreground">{fill(t("ingest.test.arrived"), { when: relativeTime(test.receivedAt, locale) })}</span>
          <code className="block truncate text-xs">{test.address}</code>
        </StatusLine>
      ) : (
        <StatusLine state="wait">
          {fill(t("ingest.test.sent"), { address: test.address })}
          <span className="block text-xs">{dateTime(test.sentAt, locale)}</span>
        </StatusLine>
      )}
    </Panel>
  )
}
