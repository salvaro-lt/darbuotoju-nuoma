"use client"
// Gavimas → Pašto dėžutės: the list, the create dialog (also used inline by the
// automation builder) and one inbox's page.
import { IngestPermissions, normalizeLocalPart, type InboxView } from "@digimuza/system-core/ingest"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, Link2, Mailbox, Plus, Trash2, Unlink, Workflow } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { CardGridSkeleton, StackSkeleton } from "@/components/app/skeletons"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { EmailList } from "./emails"
import { convexApi as api, CopyButton, CopyField, fill, relativeTime } from "./shared"

export function InboxesPage() {
  const { t } = useT()
  const inboxes = useQuery(api.ingest.listInboxes, {})
  const integration = useQuery(api.ingest.getIntegration, {})
  const [open, setOpen] = useState(false)
  const domain = integration?.receiving.domain ?? null
  const action = (
    <Can permission={IngestPermissions.manage}>
      <Button onClick={() => setOpen(true)} disabled={!domain}>
        <Plus />
        {t("ingest.inboxes.new")}
      </Button>
    </Can>
  )
  return (
    <>
      <PageHeader title={t("ingest.inboxes.title")} lead={t("ingest.inboxes.lead")} actions={action} />
      {integration && !domain && (
        <Link href="/app/ingest" className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm transition-colors hover:bg-amber-500/10">
          <Mailbox className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1">{t("ingest.inboxes.noDomain")}</span>
        </Link>
      )}
      {inboxes === undefined ? (
        <CardGridSkeleton item="h-40" />
      ) : inboxes.length === 0 ? (
        <EmptyState icon={<Mailbox />} title={t("ingest.inboxes.empty.title")} body={t("ingest.inboxes.empty.body")} action={domain ? action : undefined} />
      ) : (
        <ul className="grid animate-fade-in gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...inboxes].sort((x, y) => Number(x.status !== "active") - Number(y.status !== "active")).map((i) => (
            <li key={i.id}>
              <InboxCard inbox={i} />
            </li>
          ))}
        </ul>
      )}
      {domain && <CreateInboxDialog open={open} onOpenChange={setOpen} domain={domain} />}
    </>
  )
}

function InboxCard({ inbox }: { inbox: InboxView }) {
  const { t, locale } = useT()
  return (
    <article className={cn("relative flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm", inbox.status === "disabled" && "bg-muted/30")}>
      <header className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary shadow-xs">
          <Mailbox className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            <Link href={`/app/ingest/inboxes/${inbox.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {inbox.name}
            </Link>
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground" title={inbox.address}>
            {inbox.address}
          </p>
        </div>
        <CopyButton value={inbox.address} variant="ghost" className="relative z-10" />
      </header>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={inbox.status === "active" ? "default" : "outline"}>{inbox.status === "active" ? t("ingest.inboxes.active") : t("ingest.inboxes.disabledBadge")}</Badge>
        {inbox.purpose === "migrated" && <Badge variant="secondary">{t("ingest.inboxes.migrated")}</Badge>}
        {inbox.purpose === "test" && <Badge variant="secondary">{t("ingest.inboxes.test")}</Badge>}
        {inbox.domainMismatch && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
            {t("ingest.inboxes.mismatch")}
          </Badge>
        )}
      </div>
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Workflow className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{inbox.linked.length ? inbox.linked.map((l) => l.name).join(", ") : t("ingest.inboxes.collects")}</span>
      </p>
      <footer className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>
          {t("ingest.inboxes.received")}: <span className="font-semibold tabular-nums text-foreground">{inbox.received}</span>
        </span>
        <span>{inbox.lastReceivedAt ? fill(t("ingest.inboxes.last"), { when: relativeTime(inbox.lastReceivedAt, locale) }) : t("ingest.inboxes.never")}</span>
      </footer>
    </article>
  )
}

/** Name → address preview → create. Returns the new inbox to `onCreated` (the builder selects it). */
export function CreateInboxDialog({ open, onOpenChange, domain, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; domain: string; onCreated?: (inbox: { inboxId: string; address: string }) => void }) {
  const { t } = useT()
  const create = useMutation(api.ingest.createInbox)
  const { run, busy } = useAction()
  const [name, setName] = useState("")
  const [local, setLocal] = useState("")
  const [touched, setTouched] = useState(false)
  const [random, setRandom] = useState(false)
  const localPart = touched ? local : normalizeLocalPart(name)
  const preview = `${normalizeLocalPart(localPart) || "…"}${random ? "-xxxxxx" : ""}@${domain}`

  const reset = () => {
    setName("")
    setLocal("")
    setTouched(false)
    setRandom(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => create({ name, localPart: localPart || undefined, randomSuffix: random }), {
              success: t("ingest.create.done"),
              error: (se) => (se?.code === "CONFLICT" ? t("ingest.error.address_taken") : se?.code === "VALIDATION" ? t("ingest.error.invalid_local_part") : undefined),
            }).then((r) => {
              if (!r) return
              onCreated?.(r)
              reset()
              onOpenChange(false)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ingest.create.title")}</DialogTitle>
            <DialogDescription>{t("ingest.create.lead")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="inbox-name" className="text-sm font-medium">
              {t("ingest.create.name")}
            </label>
            <Input id="inbox-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ingest.create.namePlaceholder")} required maxLength={80} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="inbox-local" className="text-sm font-medium">
              {t("ingest.create.local")}
            </label>
            <div className="flex min-w-0 items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/50">
              <input
                id="inbox-local"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none"
                value={localPart}
                onChange={(e) => {
                  setTouched(true)
                  setLocal(e.target.value)
                }}
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="shrink-0 truncate border-l px-3 py-2 font-mono text-sm text-muted-foreground">@{domain}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("ingest.create.localHint")}</p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={random} onCheckedChange={(v) => setRandom(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">{t("ingest.create.random")}</span>
              <span className="block text-xs text-muted-foreground">{t("ingest.create.randomHint")}</span>
            </span>
          </label>
          <div className="rounded-lg border bg-muted/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{t("ingest.create.preview")}</p>
            <code className="block truncate text-sm">{preview}</code>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              <Plus />
              {t("ingest.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function InboxDetail({ inboxId }: { inboxId: string }) {
  const { t } = useT()
  const router = useRouter()
  const inbox = useQuery(api.ingest.getInbox, { inboxId })
  const canManage = useCan(IngestPermissions.manage)
  const setStatus = useMutation(api.ingest.setInboxStatus)
  const remove = useMutation(api.ingest.deleteInbox)
  const { run, busy } = useAction()
  const [confirm, setConfirm] = useState(false)

  if (inbox === undefined) return <StackSkeleton count={3} item="h-24" />
  const active = inbox.status === "active"
  return (
    <>
      <Link href="/app/ingest/inboxes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("ingest.inbox.back")}
      </Link>
      <PageHeader
        title={inbox.name}
        actions={
          canManage ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={active}
                  disabled={busy}
                  aria-label={active ? t("ingest.inbox.disable") : t("ingest.inbox.enable")}
                  onCheckedChange={(v) => void run(() => setStatus({ inboxId, status: v ? "active" : "disabled" }), { success: v ? t("ingest.inbox.enabledToast") : t("ingest.inbox.disabledToast") })}
                />
                {active ? t("ingest.inboxes.active") : t("ingest.inboxes.disabledBadge")}
              </label>
              <Button variant="outline" size="sm" onClick={() => setConfirm(true)} disabled={busy}>
                <Trash2 />
                {t("ingest.inbox.delete")}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="grid animate-fade-in gap-4">
        <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <CopyField value={inbox.address} />
            </div>
            <CopyButton value={inbox.address} label={t("ingest.inbox.copy")} variant="default" />
          </div>
          {!active && <p className="text-sm text-amber-700 dark:text-amber-300">{t("ingest.inbox.disabledNote")}</p>}
          {inbox.domainMismatch && <p className="text-sm text-amber-700 dark:text-amber-300">{t("ingest.inboxes.mismatch")}</p>}
        </section>
        <LinkedPanel inbox={inbox} canManage={canManage} />
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">{t("ingest.inbox.emails")}</h2>
          <EmailList inboxId={inboxId} />
        </section>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ingest.inbox.deleteTitle")}</DialogTitle>
            <DialogDescription>{fill(t("ingest.inbox.deleteBody"), { address: inbox.address })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(() => remove({ inboxId }), { success: t("ingest.inbox.deleted"), error: (se) => (se?.code === "CONFLICT" ? t("ingest.error.inbox_in_use") : undefined) }).then((r) => {
                  setConfirm(false)
                  if (r) router.push("/app/ingest/inboxes")
                })
              }
            >
              <Trash2 />
              {t("ingest.inbox.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LinkedPanel({ inbox, canManage }: { inbox: InboxView; canManage: boolean }) {
  const { t } = useT()
  const targets = useQuery(api.ingest.listLinkTargets, canManage ? {} : "skip")
  const link = useMutation(api.ingest.linkInbox)
  const { run, busy } = useAction()
  const linkedIds = new Set(inbox.linked.map((l) => l.id))
  const options = (targets ?? []).flatMap((g) => g.items.filter((x) => !linkedIds.has(x.id)).map((x) => ({ ...x, consumer: g.consumer })))
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <h2 className="text-sm font-semibold">{t("ingest.inbox.linkedTitle")}</h2>
      {inbox.linked.length ? (
        <ul className="grid gap-2">
          {inbox.linked.map((l) => (
            <li key={`${l.consumer}:${l.id}`} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
              <Workflow className="size-4 shrink-0 text-primary" aria-hidden />
              {l.href ? (
                <Link href={l.href} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {l.name}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
              )}
              <Badge variant={l.enabled ? "default" : "outline"}>{l.enabled ? t("auto.on") : t("auto.off")}</Badge>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => link({ inboxId: inbox.id, consumer: l.consumer, refId: l.id, linked: false }), { success: t("ingest.inbox.unlinkedToast") })}
                >
                  <Unlink />
                  {t("ingest.inbox.unlink")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ingest.inbox.linkedNone")}</p>
      )}
      {canManage && inbox.status === "active" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link2 className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
          <Select
            value=""
            disabled={busy || !options.length}
            onValueChange={(v) => {
              const o = options.find((x) => `${x.consumer}:${x.id}` === v)
              if (o) void run(() => link({ inboxId: inbox.id, consumer: o.consumer, refId: o.id, linked: true }), { success: t("ingest.inbox.linkedToast") })
            }}
          >
            <SelectTrigger className="w-full sm:w-80" aria-label={t("ingest.inbox.link")}>
              <SelectValue placeholder={options.length ? t("ingest.inbox.link") : t("ingest.inbox.linkNone")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={`${o.consumer}:${o.id}`} value={`${o.consumer}:${o.id}`}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </section>
  )
}
