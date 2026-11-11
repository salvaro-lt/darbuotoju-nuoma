"use client"
import type { SubmissionDetail, SubmitterView } from "@digimuza/documents"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { AlertTriangle, ArrowLeft, Ban, Download, FileText, Link2, Mail, MoreHorizontal, RotateCw, SearchX } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { CopyButton } from "@/components/audit/copy-button"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { PdfPages } from "@/components/documents/pdf-pages"
import { boxStyle, FieldValue, roleColor } from "@/components/documents/signing-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDate, formatTime } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { documentHref, useSigningVisible } from "../../_components/use-documents"
import { SignerDot, SubmissionBadge } from "./status"

export function SubmissionDetailView({ submissionId }: { submissionId: string }) {
  const { t } = useT()
  const visible = useSigningVisible()
  const s = useQuery(api.documents.getSubmission, visible ? { submissionId } : "skip")
  if (!visible) return <p className="text-sm text-muted-foreground">{t("sign.off")}</p>
  if (s === undefined)
    return (
      <div className="grid gap-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="aspect-[1/1.414] w-full rounded-none" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    )
  if (s === null)
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("sign.submission.missing")}
        action={
          <Button variant="outline" asChild>
            <Link href="/app/documents/signing">{t("sign.submission.back")}</Link>
          </Button>
        }
      />
    )
  return <Detail s={s} />
}

function Detail({ s }: { s: SubmissionDetail }) {
  const { t, locale } = useT()
  const canSend = useCan(DocumentsPermissions.signingSend)
  const cancel = useMutation(api.documents.cancelSubmission)
  const retry = useMutation(api.documents.retryFinalize)
  const { run, busy } = useAction()
  const id = s.id as Id<"docSubmissions">
  const preparing = s.status === "completed" && !s.signedUrl && !s.finalizeError
  const when = (ms: number) => `${formatDate(ms, locale)} ${formatTime(ms, locale)}`

  return (
    <>
      <div className="mb-2">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link href="/app/documents/signing">
            <ArrowLeft /> {t("sign.submission.back")}
          </Link>
        </Button>
      </div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{s.name}</h1>
            <SubmissionBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sign.submission.sentBy").replace("{name}", s.createdByName).replace("{date}", when(s.createdAt))}
            {s.expiresAt && s.status === "pending" ? ` · ${t("sign.submission.expires")} ${formatDate(s.expiresAt, locale)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSend && s.status === "pending" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => window.confirm(t("sign.submission.cancelConfirm")) && void run(() => cancel({ submissionId: id }), { success: t("sign.submission.cancelled") })}
            >
              <Ban /> {t("sign.submission.cancel")}
            </Button>
          )}
          {s.fileUrl && (
            <Button variant="outline" asChild>
              <a href={s.fileUrl} target="_blank" rel="noreferrer">
                <FileText /> {t("sign.submission.original")}
              </a>
            </Button>
          )}
          {s.signedUrl && (
            <Button asChild>
              <a href={s.signedUrl} target="_blank" rel="noreferrer">
                <Download /> {t("sign.submission.download")}
              </a>
            </Button>
          )}
        </div>
      </header>

      {s.finalizeError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>{t("sign.submission.finalizeFailed")}</AlertTitle>
          <AlertDescription>
            <p>{s.finalizeError}</p>
            {canSend && (
              <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void run(() => retry({ submissionId: id }), { success: t("sign.submission.retrying") })}>
                <RotateCw /> {t("sign.submission.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {preparing && <p className="mb-6 text-sm text-muted-foreground" aria-live="polite">{t("sign.submission.preparing")}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label={t("sign.submission.preview")} className="rounded-xl bg-muted/50 px-3 py-4 md:px-6 md:py-6">
          <PdfPages
            url={s.fileUrl}
            pages={s.pages}
            maxWidth={820}
            overlay={(page) =>
              s.fields
                .filter((f) => f.page === page.index)
                .map((f) => {
                  const value = s.values[f.id]
                  return (
                    <div key={f.id} className="absolute" style={{ ...boxStyle(f), ...(value === undefined ? { outline: `1.5px dashed ${roleColor(f.role, 0.7)}`, background: roleColor(f.role, 0.06) } : {}) }} title={s.roles[f.role]}>
                      {value !== undefined && <FieldValue field={f} value={value} pxHeight={f.h * page.height} />}
                    </div>
                  )
                })
            }
          />
        </section>

        <div className="grid gap-6 lg:sticky lg:top-6">
          <section aria-labelledby="signers-h" className="rounded-xl border">
            <h2 id="signers-h" className="border-b px-4 py-3 text-sm font-medium">
              {t("sign.submissions.signers")}
            </h2>
            <ul className="divide-y">
              {s.submitters.map((x) => (
                <SignerRow key={x.id} x={x} pending={s.status === "pending"} canSend={canSend} when={when} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="events-h" className="rounded-xl border">
            <h2 id="events-h" className="border-b px-4 py-3 text-sm font-medium">
              {t("sign.submission.events")}
            </h2>
            <ol className="grid gap-3 px-4 py-3">
              {[...s.events].reverse().map((e, i) => (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                  <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                  <div className="min-w-0">
                    <p>
                      {t(`sign.event.${e.kind}` as MessageKey)}
                      {e.submitterName && <span className="text-muted-foreground"> · {e.submitterName}</span>}
                    </p>
                    {e.detail && (e.kind === "declined" || e.kind === "send_failed" || e.kind === "finalize_failed" || e.kind === "cancelled") && <p className="text-xs break-words text-muted-foreground">{e.detail}</p>}
                    <p className="text-xs text-muted-foreground tabular-nums">{when(e.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="integrity-h" className="grid gap-3 rounded-xl border px-4 py-3 text-sm">
            <h2 id="integrity-h" className="font-medium">
              {t("sign.submission.integrity")}
            </h2>
            <Hash label={t("sign.submission.originalHash")} value={s.sha256} />
            {s.signedSha256 && <Hash label={t("sign.submission.signedHash")} value={s.signedSha256} />}
            {s.documentId && (
              <Button variant="outline" size="sm" className="justify-self-start" asChild>
                <Link href={documentHref(s.documentId)}>
                  <FileText /> {t("sign.submission.archived")}
                </Link>
              </Button>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <CopyButton value={value} label={label} />
      </div>
    </div>
  )
}

function SignerRow({ x, pending, canSend, when }: { x: SubmitterView; pending: boolean; canSend: boolean; when: (ms: number) => string }) {
  const { t } = useT()
  const resend = useMutation(api.documents.resendInvite)
  const { run, busy } = useAction()
  const active = pending && (x.status === "pending" || x.status === "opened")

  async function newLink(sendEmail: boolean) {
    if (!window.confirm(t("sign.submission.newLinkConfirm"))) return
    const res = await run(() => resend({ submitterId: x.id as Id<"docSubmitters">, sendEmail }), { success: sendEmail ? t("sign.submission.resent") : undefined })
    if (res && !sendEmail) {
      await navigator.clipboard.writeText(res.url).then(
        () => toast.success(t("sign.submission.linkCopied")),
        () => toast.message(res.url),
      )
    }
  }

  const step = x.completedAt && x.status === "completed" ? `${t("sign.signer.completed")} ${when(x.completedAt)}` : x.openedAt ? `${t("sign.signer.opened")} ${when(x.openedAt)}` : x.sentAt ? `${t("sign.submission.emailed")} ${when(x.sentAt)}` : t(`sign.signer.${x.status}` as MessageKey)

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: roleColor(x.role) }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{x.name || x.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {x.roleName} · {x.email}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <SignerDot status={x.status} />
          <span className="tabular-nums">{step}</span>
        </p>
        {x.declineReason && <p className="mt-1 text-xs break-words text-destructive">„{x.declineReason}“</p>}
      </div>
      {canSend && active && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={t("sign.actions")} disabled={busy}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void newLink(true)}>
              <Mail /> {t("sign.submission.resend")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void newLink(false)}>
              <Link2 /> {t("sign.submission.copyLink")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
