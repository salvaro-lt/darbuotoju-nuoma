"use client"
// Received email: the list (all inboxes or one) and the message view. The html
// comes sanitised from Convex and is shown in a sandboxed iframe (no scripts, no
// same-origin, remote images blocked until the reader allows them).
import type { DeliveryView, EmailSummaryView } from "@digimuza/system-core/ingest"
import type { AutomationRunStatus } from "@digimuza/system-core/automations"
import { useQuery } from "convex/react"
import { ImageOff, Inbox, Paperclip, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { ListRowsSkeleton, StackSkeleton } from "@/components/app/skeletons"
import { RunStatusBadge } from "@/components/automations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { convexApi as api, dateTime, relativeTime } from "./shared"

const RUN_STATUSES = new Set(["queued", "extracted", "pending_review", "inserted", "rejected", "failed"])

export function EmailList({ inboxId, showInbox = false }: { inboxId?: string; showInbox?: boolean }) {
  const { t, locale } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [limit, setLimit] = useState(30)
  const page = useQuery(api.ingest.listEmails, { ...(inboxId ? { inboxId } : {}), limit })
  const open = params.get("email")
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set("email", id)
    else next.delete("email")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }

  if (page === undefined) return <ListRowsSkeleton rows={4} />
  if (!page.items.length) return <EmptyState icon={<Inbox />} title={t("ingest.emails.empty.title")} body={t("ingest.emails.empty.body")} />
  return (
    <>
      <ul className="grid animate-fade-in divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {page.items.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setOpen(e.id)} className="grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{e.fromName || e.from || "—"}</span>
                {e.fromName && <span className="block truncate text-xs text-muted-foreground">{e.from}</span>}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm">{e.subject || t("ingest.emails.noSubject")}</span>
                  {e.attachments > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                      <Paperclip className="size-3" aria-hidden />
                      {e.attachments}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{showInbox ? e.inboxAddress : e.snippet}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                <Deliveries deliveries={e.deliveries} compact />
                <time dateTime={new Date(e.receivedAt).toISOString()} title={dateTime(e.receivedAt, locale)} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {relativeTime(e.receivedAt, locale)}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!page.done && (
        <Button variant="outline" className="justify-self-center" onClick={() => setLimit((n) => n + 30)}>
          {t("ingest.emails.more")}
        </Button>
      )}
      <EmailSheet emailId={open} onClose={() => setOpen(null)} />
    </>
  )
}

function Deliveries({ deliveries, compact = false }: { deliveries: DeliveryView[]; compact?: boolean }) {
  const { t } = useT()
  if (!deliveries.length) return compact ? null : <p className="text-sm text-muted-foreground">{t("ingest.emails.nobody")}</p>
  return (
    <span className={cn("flex flex-wrap gap-1.5", !compact && "grid gap-2")}>
      {deliveries.map((d) =>
        compact ? (
          <span key={`${d.consumer}:${d.refId}`} className="inline-flex items-center gap-1">
            {d.status && RUN_STATUSES.has(d.status) ? <RunStatusBadge status={d.status as AutomationRunStatus} /> : <Badge variant="outline">{t(`ingest.outcome.${d.outcome}` as MessageKey)}</Badge>}
          </span>
        ) : (
          <span key={`${d.consumer}:${d.refId}`} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
            {d.href ? (
              <Link href={d.href} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {d.name}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
            )}
            <Badge variant="outline">{t(`ingest.outcome.${d.outcome}` as MessageKey)}</Badge>
            {d.status && RUN_STATUSES.has(d.status) && <RunStatusBadge status={d.status as AutomationRunStatus} />}
          </span>
        ),
      )}
    </span>
  )
}

function EmailSheet({ emailId, onClose }: { emailId: string | null; onClose: () => void }) {
  const { t } = useT()
  return (
    <Sheet open={!!emailId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">{emailId ? <EmailBody emailId={emailId} /> : <SheetTitle className="sr-only">{t("ingest.emails.title")}</SheetTitle>}</SheetContent>
    </Sheet>
  )
}

function EmailBody({ emailId }: { emailId: string }) {
  const { t, locale } = useT()
  const email = useQuery(api.ingest.getEmail, { emailId })
  const [images, setImages] = useState(false)
  if (email === undefined)
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">{t("ingest.emails.title")}</SheetTitle>
        <StackSkeleton count={4} item="h-12" />
      </div>
    )
  const rows: [string, string][] = [
    [t("ingest.emails.from"), email.fromName ? `${email.fromName} <${email.from}>` : email.from],
    [t("ingest.email.to"), email.to.join(", ")],
    ...(email.cc.length ? ([[t("ingest.email.cc"), email.cc.join(", ")]] as [string, string][]) : []),
    ...(email.replyTo.length ? ([[t("ingest.email.replyTo"), email.replyTo.join(", ")]] as [string, string][]) : []),
    [t("ingest.email.inbox"), email.inboxAddress],
    [t("ingest.emails.received"), dateTime(email.receivedAt, locale)],
  ]
  const files = email.attachmentList.filter((a) => !a.inline)
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="pr-8 text-lg leading-snug">{email.subject || t("ingest.emails.noSubject")}</SheetTitle>
        <SheetDescription className="sr-only">{email.from}</SheetDescription>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 pt-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {email.authentication && (
          <p className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("ingest.email.auth")}:
            {(["spf", "dkim", "dmarc"] as const).map((k) =>
              email.authentication?.[k] ? (
                <Badge key={k} variant={email.authentication[k] === "pass" ? "secondary" : "outline"} className="font-mono text-[11px] uppercase">
                  {k} {email.authentication[k]}
                </Badge>
              ) : null,
            )}
          </p>
        )}
      </SheetHeader>
      <div className="grid gap-4 p-4">
        {email.status === "metadata_only" && <p className="text-sm text-amber-700 dark:text-amber-300">{t("ingest.emails.metadataOnly")}</p>}
        {email.truncated && <p className="text-xs text-muted-foreground">{t("ingest.email.truncated")}</p>}
        <Tabs defaultValue={email.html ? "html" : "text"}>
          <TabsList>
            {email.html && <TabsTrigger value="html">{t("ingest.email.html")}</TabsTrigger>}
            <TabsTrigger value="text">{t("ingest.email.text")}</TabsTrigger>
          </TabsList>
          {email.html && (
            <TabsContent value="html" className="mt-3 grid gap-2">
              {email.remoteImages && !images && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <ImageOff className="size-3.5" aria-hidden />
                  <span className="flex-1">{t("ingest.email.images")}</span>
                  <Button size="sm" variant="ghost" onClick={() => setImages(true)}>
                    {t("ingest.email.showImages")}
                  </Button>
                </div>
              )}
              <HtmlFrame html={email.html} images={images} title={email.subject} />
            </TabsContent>
          )}
          <TabsContent value="text" className="mt-3">
            {email.text ? <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/30 p-3 font-sans text-sm whitespace-pre-wrap">{email.text}</pre> : <p className="text-sm text-muted-foreground">{t("ingest.email.noBody")}</p>}
          </TabsContent>
        </Tabs>
        {files.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">{t("ingest.email.attachments")}</h3>
            <ul className="grid gap-1.5">
              {files.map((a, i) => (
                <li key={a.id ?? i} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {a.type && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{a.type}</span>}
                  {a.size !== undefined && <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{formatSize(a.size)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">{t("ingest.email.deliveries")}</h3>
          <Deliveries deliveries={email.deliveries} />
        </section>
      </div>
    </>
  )
}

/** Sanitised html in an iframe without scripts or same-origin; a CSP blocks remote loads unless allowed. */
function HtmlFrame({ html, images, title }: { html: string; images: boolean; title: string }) {
  const doc = useMemo(() => {
    const img = images ? "img-src data: cid: https: http:" : "img-src data: cid:"
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>html{color-scheme:light}body{margin:0;padding:16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`
  }, [html, images])
  return <iframe title={title || "email"} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} referrerPolicy="no-referrer" className="h-[min(60vh,30rem)] w-full rounded-lg border bg-white" />
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export type { EmailSummaryView }
