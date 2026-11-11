"use client"
// The email channel of the automation builder: which inbox (Gavimas) it reads.
// Hidden when the ingest module is off or the person cannot see inboxes: the
// automation then gets its own new inbox (or the generated address) on save.
import { IngestPermissions } from "@digimuza/system-core/ingest"
import { useCan } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { Mailbox, Plus } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n/client"
import { CreateInboxDialog } from "./inboxes"
import { convexApi as api, HealthBadge, useIngestEnabled } from "./shared"

const AUTO = "__auto__"

export function InboxPicker({ value, onChange }: { value: string | undefined; onChange: (inboxId: string | undefined) => void }) {
  const { t } = useT()
  const on = useIngestEnabled()
  const canRead = useCan(IngestPermissions.read)
  const canManage = useCan(IngestPermissions.manage)
  const inboxes = useQuery(api.ingest.listInboxes, on && canRead ? {} : "skip")
  const integration = useQuery(api.ingest.getIntegration, on && canRead ? {} : "skip")
  const [open, setOpen] = useState(false)
  if (!on || !canRead) return null
  const domain = integration?.receiving.domain ?? null
  const active = (inboxes ?? []).filter((i) => i.status === "active" || i.id === value)
  return (
    <Field>
      <FieldLabel htmlFor="a-inbox">{t("ingest.picker.label")}</FieldLabel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={value ?? AUTO} onValueChange={(v) => onChange(v === AUTO ? undefined : v)}>
          <SelectTrigger id="a-inbox" className="w-full sm:w-96">
            <SelectValue placeholder={t("ingest.picker.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>{t("ingest.picker.auto")}</SelectItem>
            {active.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                <span className="truncate">
                  {i.name} · <span className="font-mono text-xs text-muted-foreground">{i.address}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && domain && (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <Plus />
            {t("ingest.picker.new")}
          </Button>
        )}
      </div>
      <FieldDescription>{domain ? t("ingest.picker.hint") : t("ingest.picker.noDomain")}</FieldDescription>
      {domain && <CreateInboxDialog open={open} onOpenChange={setOpen} domain={domain} onCreated={(r) => onChange(r.inboxId)} />}
    </Field>
  )
}

/** The automation's "Prijungimas" with Gavimas on: its inbox and the integration's state. Null when off. */
export function AutomationInboxNote({ inboxId }: { inboxId: string | undefined }) {
  const { t } = useT()
  const on = useIngestEnabled()
  const canRead = useCan(IngestPermissions.read)
  const inbox = useQuery(api.ingest.getInbox, on && canRead && inboxId ? { inboxId } : "skip")
  const integration = useQuery(api.ingest.getIntegration, on && canRead ? {} : "skip")
  if (!on || !canRead || !integration) return null
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{t("ingest.picker.label")}</h3>
        <HealthBadge health={integration.health} />
      </div>
      {inbox ? (
        <Link href={`/app/ingest/inboxes/${inbox.id}`} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
          <Mailbox className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{inbox.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{inbox.address}</span>
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ingest.picker.auto")}</p>
      )}
      <Link href="/app/ingest" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        {t("nav.ingest")} → {t("ingest.nav.integrations")}
      </Link>
    </section>
  )
}
