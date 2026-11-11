"use client"
// Client document package: send to the client by email (DIG-113). The composer
// dialog, the project's send log with approve / send anyway / cancel, the
// "siųsti automatiškai" switch, download links, and the worker card's history.
import type { PackageLogView, PackageRecipient, WorkerPackageSend } from "@digimuza/staffing"
import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { formatBytes, type PackageLanguage, type PackageStatus } from "@digimuza/staffing/compliance/pure"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Ban, ChevronDown, Link2, Mail, Send, ShieldCheck, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { complianceProjectHref, fmt, useComplianceEnabled } from "./compliance-ui"

const P = StaffingCompliancePermissions
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dateTime = (ms: number) => {
  const d = new Date(ms)
  return `${day(ms)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const STATUS_CLASS: Record<PackageStatus, string> = {
  needs_approval: "border-marking bg-marking text-marking-foreground",
  ready: "border-steel-green/50 bg-steel-green/15 text-foreground",
  queued: "border-transparent bg-secondary text-secondary-foreground",
  sending: "border-transparent bg-secondary text-secondary-foreground",
  sent: "border-transparent bg-steel-green/15 text-foreground",
  failed: "border-destructive text-destructive",
  not_configured: "border-marking text-foreground",
  cancelled: "text-muted-foreground",
}

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  const { t } = useT()
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {t(`compliance.send.status.${status}` as MessageKey)}
    </Badge>
  )
}

/** "Paskutinį kartą siųsta klientui …" for a project (readiness and package pages). */
export function LastSentNote({ projectId }: { projectId: string }) {
  const { t } = useT()
  const on = useComplianceEnabled()
  const log = useQuery(api.compliance.listPackages, on ? { projectId: projectId as Id<"staffing_projects"> } : "skip")
  if (!log) return null
  const last = log.find((p) => p.status === "sent" && p.sentAt)
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Mail className="size-3.5" aria-hidden />
      {last ? fmt(t("compliance.send.lastSent"), { date: dateTime(last.sentAt!), to: last.recipients.map((r) => r.email).join(", ") }) : t("compliance.send.neverSent")}
    </span>
  )
}

/** The send section of the package page: auto-send switch, composer, send log. */
export function PackageSendPanel({ projectId }: { projectId: string }) {
  const { t } = useT()
  const pid = projectId as Id<"staffing_projects">
  const canSend = useCan(P.packageSend)
  const composer = useQuery(api.compliance.getPackageComposer, { projectId: pid })
  const log = useQuery(api.compliance.listPackages, { projectId: pid })
  const setSettings = useMutation(api.compliance.setPackageSettings)
  const { run, busy } = useAction()
  const [open, setOpen] = useState(false)
  if (composer === undefined || log === undefined) return <Skeleton className="h-48 w-full" />
  if (composer === null) return null

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4" aria-hidden />
            {t("compliance.send.title")}
          </CardTitle>
          <CardDescription>{t("compliance.send.lead")}</CardDescription>
          <LastSentNote projectId={projectId} />
        </div>
        {canSend && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2" title={t("compliance.send.autoHint")}>
              <Switch
                id="pkg-auto"
                checked={composer.settings.autoSend}
                disabled={busy}
                onCheckedChange={(autoSend) =>
                  void run(() => setSettings({ projectId: pid, autoSend, ...(composer.settings.recipients.length ? { recipients: composer.settings.recipients } : {}), language: composer.settings.language }), {
                    success: autoSend ? t("compliance.send.autoOn") : t("compliance.send.autoOff"),
                  })
                }
              />
              <Label htmlFor="pkg-auto">{t("compliance.send.auto")}</Label>
            </div>
            <Button size="sm" onClick={() => setOpen(true)} disabled={composer.candidates.length === 0}>
              <Mail />
              {t("compliance.send.open")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <h3 className="mb-2 text-sm font-medium">{t("compliance.send.history")}</h3>
        {log.length === 0 ? <p className="text-sm text-muted-foreground">{t("compliance.send.historyEmpty")}</p> : <PackageLog log={log} canSend={canSend} />}
      </CardContent>
      {open && <ComposerDialog projectId={pid} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function ComposerDialog({ projectId, onClose }: { projectId: Id<"staffing_projects">; onClose: () => void }) {
  const { t } = useT()
  const composer = useQuery(api.compliance.getPackageComposer, { projectId })
  const create = useMutation(api.compliance.createPackage)
  const { run, busy } = useAction()
  const [recipients, setRecipients] = useState<PackageRecipient[] | null>(null)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [language, setLanguage] = useState<PackageLanguage | null>(null)
  const [extra, setExtra] = useState("")
  const [note, setNote] = useState("")
  const [noteDebounced, setNoteDebounced] = useState("")
  useEffect(() => {
    const h = setTimeout(() => setNoteDebounced(note), 400)
    return () => clearTimeout(h)
  }, [note])

  // Defaults once the composer is loaded: saved recipients or the client's contacts, the confirmed team.
  const options = useMemo(() => {
    if (!composer) return []
    const all = new Map<string, PackageRecipient>()
    for (const r of [...composer.settings.recipients, ...composer.contacts]) if (!all.has(r.email)) all.set(r.email, r)
    for (const r of recipients ?? []) if (!all.has(r.email)) all.set(r.email, r)
    return [...all.values()]
  }, [composer, recipients])
  const chosen = recipients ?? (composer ? (composer.settings.recipients.length ? composer.settings.recipients : composer.contacts) : [])
  const members = selected ?? new Set(composer?.candidates.map((c) => c.workerId) ?? [])
  const lang = language ?? composer?.settings.language ?? "lt"
  const args = composer
    ? { projectId, workerIds: [...members] as Id<"staffing_workers">[], recipients: chosen, language: lang, ...(noteDebounced.trim() ? { note: noteDebounced } : {}) }
    : null
  const preview = useQuery(api.compliance.previewPackage, args && members.size > 0 ? args : "skip")

  const toggleRecipient = (r: PackageRecipient, on: boolean) => setRecipients(on ? [...chosen.filter((x) => x.email !== r.email), r] : chosen.filter((x) => x.email !== r.email))
  const toggleMember = (id: string, on: boolean) => {
    const next = new Set(members)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }
  function addExtra() {
    const email = extra.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    setRecipients([...chosen.filter((x) => x.email !== email), { email }])
    setExtra("")
  }

  async function submit() {
    if (!args) return
    const res = await run(() => create({ ...args, ...(note.trim() ? { note } : {}) }))
    if (!res) return
    toast.success(t(`compliance.send.created.${res.status === "queued" ? "queued" : res.status === "ready" ? "ready" : "needs_approval"}` as MessageKey))
    onClose()
  }

  const auto = composer?.settings.autoSend ?? false
  const submitLabel = !preview ? t("compliance.send.create") : preview.complete ? (auto ? t("compliance.send.createAndSend") : t("compliance.send.create")) : t("compliance.send.createForApproval")

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("compliance.send.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("compliance.send.dialogLead")}</DialogDescription>
        </DialogHeader>
        {!composer ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
            <FieldGroup>
              <Field>
                <FieldLabel>{t("compliance.send.recipients")}</FieldLabel>
                {options.length === 0 && <FieldDescription>{t("compliance.send.noContacts")}</FieldDescription>}
                <div className="grid gap-1.5">
                  {options.map((r) => (
                    <label key={r.email} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={chosen.some((x) => x.email === r.email)} onCheckedChange={(v) => toggleRecipient(r, v === true)} />
                      <span>
                        {r.name && <span className="font-medium">{r.name} </span>}
                        <span className="text-muted-foreground">{r.email}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={extra}
                    placeholder={t("compliance.send.addEmail")}
                    onChange={(e) => setExtra(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addExtra()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={addExtra}>
                    {t("compliance.send.add")}
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="pkg-lang">{t("compliance.send.language")}</FieldLabel>
                <NativeSelect id="pkg-lang" value={lang} onChange={(v) => setLanguage(v as PackageLanguage)}>
                  {(["lt", "en", "nl"] as const).map((l) => (
                    <option key={l} value={l}>
                      {t(`compliance.send.lang.${l}` as MessageKey)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>{t("compliance.send.members")}</FieldLabel>
                <FieldDescription>{t("compliance.send.membersHint")}</FieldDescription>
                <div className="grid gap-1.5">
                  {composer.candidates.map((c) => (
                    <label key={c.workerId} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={members.has(c.workerId)} onCheckedChange={(v) => toggleMember(c.workerId, v === true)} />
                      <span className="font-medium">{c.workerName}</span>
                      <span className="text-muted-foreground">{c.tradeName}</span>
                      {c.readiness === "blocked" && <TriangleAlert className="size-3.5 text-destructive" aria-label="!" />}
                    </label>
                  ))}
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="pkg-note">{t("compliance.send.note")}</FieldLabel>
                <Textarea id="pkg-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </FieldGroup>
            <div className="grid content-start gap-3">
              {!preview ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <>
                  {preview.complete ? (
                    <Alert className="border-steel-green/50 bg-steel-green/10">
                      <ShieldCheck />
                      <AlertTitle>{t("compliance.send.complete")}</AlertTitle>
                      {auto && <AlertDescription>{t("compliance.send.autoHint")}</AlertDescription>}
                    </Alert>
                  ) : (
                    <Alert className="border-marking bg-marking/15">
                      <TriangleAlert />
                      <AlertTitle>{fmt(t("compliance.send.incomplete"), { count: preview.missing.length })}</AlertTitle>
                      <AlertDescription>
                        <GapList gaps={preview.missing} />
                      </AlertDescription>
                    </Alert>
                  )}
                  {preview.warnings.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium">{t("compliance.send.warningsTitle")}: </span>
                      <span className="text-muted-foreground">{preview.warnings.map((w) => `${w.workerName} – ${w.document} (${w.expiresAt ?? "?"})`).join("; ")}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {fmt(t(preview.delivery === "link" ? "compliance.send.overCap" : "compliance.send.attachments"), { count: preview.fileCount, size: formatBytes(preview.totalBytes), cap: formatBytes(preview.capBytes) })}
                  </p>
                  <div className="rounded-md border bg-muted/40">
                    <div className="border-b px-3 py-2 text-xs">
                      <span className="text-muted-foreground">{t("compliance.send.subject")}: </span>
                      <span className="font-medium">{preview.subject}</span>
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed">{preview.text}</pre>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("compliance.send.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !preview || chosen.length === 0 || members.size === 0}>
            <Send />
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GapList({ gaps }: { gaps: PackageLogView["missing"] }) {
  const { t } = useT()
  return (
    <ul className="mt-1 list-disc pl-5">
      {gaps.map((g, i) => (
        <li key={i}>
          <b>{g.workerName}</b>: {g.document} ({t(`compliance.send.reason.${g.reason}` as MessageKey)}
          {g.reason === "expired" && g.expiresAt ? ` ${g.expiresAt}` : ""})
        </li>
      ))}
    </ul>
  )
}

function PackageLog({ log, canSend }: { log: PackageLogView[]; canSend: boolean }) {
  return (
    <ol className="grid gap-3">
      {log.map((p) => (
        <PackageLogItem key={p.id} p={p} canSend={canSend} />
      ))}
    </ol>
  )
}

function PackageLogItem({ p, canSend }: { p: PackageLogView; canSend: boolean }) {
  const { t } = useT()
  const send = useMutation(api.compliance.sendPackage)
  const cancel = useMutation(api.compliance.cancelPackage)
  const makeLink = useMutation(api.compliance.createPackageLink)
  const revoke = useMutation(api.compliance.revokePackageLinks)
  const { run, busy } = useAction()
  const [url, setUrl] = useState<string | null>(null)
  const id = p.id as Id<"staffing_compliance_packages">
  const sendLabel = p.status === "needs_approval" ? t("compliance.send.sendAnyway") : p.status === "ready" ? t("compliance.send.send") : t("compliance.send.retry")
  const canAct = canSend && ["needs_approval", "ready", "failed", "not_configured"].includes(p.status)

  async function link() {
    const r = await run(() => makeLink({ packageId: id }))
    if (!r) return
    setUrl(r.url)
    try {
      await navigator.clipboard.writeText(r.url)
    } catch {
      /* clipboard may be blocked; the URL is shown */
    }
    toast.success(t("compliance.send.linkCreated"))
  }

  return (
    <li className={`rounded-lg border p-3 ${p.status === "needs_approval" ? "border-marking" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <PackageStatusBadge status={p.status} />
            <span className="text-sm font-medium">{p.sentAt ? fmt(t("compliance.send.sentAt"), { date: dateTime(p.sentAt) }) : dateTime(p.createdAt)}</span>
            <span className="text-xs text-muted-foreground">
              {t(`compliance.send.trigger.${p.trigger}` as MessageKey)} · {p.language.toUpperCase()} · {p.delivery === "link" ? t("compliance.send.viaLink") : t("compliance.send.viaAttachments")}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t("compliance.send.to")}: <span className="text-foreground">{p.recipients.map((r) => r.email).join(", ")}</span> · {p.members.length} · {fmt(t("compliance.send.files"), { count: p.fileCount, size: formatBytes(p.totalBytes) })}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmt(t("compliance.send.createdBy"), { name: p.createdByName })}
            {p.approvedByName && p.approvedAt ? ` · ${fmt(t("compliance.send.approvedBy"), { name: p.approvedByName })} ${dateTime(p.approvedAt)}` : ""}
            {p.cancelledByName && p.cancelledAt ? ` · ${fmt(t("compliance.send.cancelledBy"), { name: p.cancelledByName })} ${dateTime(p.cancelledAt)}` : ""}
            {p.redirectedTo ? ` · ${fmt(t("compliance.send.redirected"), { email: p.redirectedTo })}` : ""}
          </div>
          {p.link && p.link.state !== "not_found" && (
            <div className="text-xs text-muted-foreground">
              <Link2 className="mr-1 inline size-3" aria-hidden />
              {fmt(t(`compliance.send.linkState.${p.link.state}` as MessageKey), { date: day(p.link.expiresAt) })} · {fmt(t("compliance.send.downloads"), { count: p.link.downloads })}
              {p.accesses.length > 0 && ` · ${p.accesses.slice(0, 3).map((a) => `${t(`compliance.send.access.${a.kind}` as MessageKey)} ${dateTime(a.at)}`).join(", ")}`}
            </div>
          )}
        </div>
        {canSend && (
          <div className="flex flex-wrap gap-2">
            {canAct && (
              <Button size="sm" variant={p.status === "needs_approval" ? "outline" : "default"} disabled={busy} onClick={() => void run(() => send({ packageId: id }), { success: t("compliance.send.sent") })}>
                <Send />
                {sendLabel}
              </Button>
            )}
            {p.status !== "cancelled" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void link()}>
                <Link2 />
                {t("compliance.send.link")}
              </Button>
            )}
            {canAct && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => cancel({ packageId: id }), { success: t("compliance.send.cancelled") })}>
                <Ban />
                {t("compliance.send.cancel")}
              </Button>
            )}
            {p.link?.state === "ok" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => revoke({ packageId: id }), { success: t("compliance.send.revoked") })}>
                {t("compliance.send.revoke")}
              </Button>
            )}
          </div>
        )}
      </div>
      {p.missing.length > 0 && (
        <div className={`mt-2 rounded-md px-3 py-2 text-xs ${p.status === "needs_approval" ? "bg-marking/15" : "bg-muted/50"}`}>
          <span className="font-medium">{t("compliance.send.missingTitle")}:</span>
          <GapList gaps={p.missing} />
        </div>
      )}
      {p.status === "not_configured" && <p className="mt-2 text-xs text-muted-foreground">{t("compliance.send.notConfiguredHint")}</p>}
      {p.status === "failed" && p.error && <p className="mt-2 text-xs text-destructive">{p.error}</p>}
      {url && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Input readOnly value={url} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="outline" className="h-8" onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success(t("compliance.send.copy")))}>
            {t("compliance.send.copy")}
          </Button>
        </div>
      )}
      <Collapsible>
        <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className="size-3" aria-hidden />
          {t("compliance.send.details")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <ul className="grid gap-1.5 text-xs">
              {p.members.map((m) => (
                <li key={m.workerId}>
                  <span className="font-medium">{m.workerName}</span> <span className="text-muted-foreground">{m.tradeName}</span>
                  <div className="text-muted-foreground">
                    {m.documents
                      .map((d) => `${d.name}${d.number ? ` ${d.number}` : ""}: ${d.status === "missing" ? "—" : (d.expiresAt ?? "∞")}${d.version ? ` (v${day(d.version)})` : ""}`)
                      .join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded-md border bg-muted/40">
              <div className="border-b px-3 py-1.5 text-xs font-medium">{p.subject}</div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed">{p.text}</pre>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

/** On the worker card: when this worker's documents last went to a client. */
export function WorkerPackageSends({ workerId }: { workerId: string }) {
  const { t } = useT()
  const on = useComplianceEnabled()
  const can = useCan(P.readinessRead)
  const rows = useQuery(api.compliance.workerPackageSends, on && can ? { workerId: workerId as Id<"staffing_workers"> } : "skip")
  if (!on || !can || rows === undefined) return null
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" aria-hidden />
          {t("compliance.send.workerTitle")}
        </CardTitle>
        {rows[0] && <CardDescription>{fmt(t("compliance.send.lastSent"), { date: dateTime(rows[0].sentAt), to: rows[0].to.join(", ") })}</CardDescription>}
      </CardHeader>
      <CardContent className="px-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("compliance.send.workerNever")}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {rows.map((r: WorkerPackageSend) => (
              <li key={r.packageId} className="flex flex-wrap items-center gap-2">
                <Link href={`${complianceProjectHref(r.projectId)}/package`} className="hover:underline">
                  {fmt(t("compliance.send.workerRow"), { project: `${r.projectCode} ${r.projectName}`, date: dateTime(r.sentAt), count: r.documents })}
                </Link>
                {r.missing > 0 && (
                  <Badge variant="outline" className="border-marking text-foreground">
                    {fmt(t("compliance.send.workerMissing"), { count: r.missing })}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
