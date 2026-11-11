"use client"
// DIG-111: client timesheets received by email (Gavimas inbox → PDF → client sheet to review).
import type { IntakeRow } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Inbox, MailOpen, Paperclip } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { fmt, sheetHref, useDateFormat } from "./timesheets-ui"

const STATUS_VARIANT: Record<IntakeRow["status"], "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  imported: "secondary",
  no_pdf: "outline",
  no_match: "destructive",
  failed: "destructive",
}

export function EmailIntake() {
  const { t } = useT()
  const data = useQuery(api.timesheets.listIntake, {})
  const [picking, setPicking] = useState(false)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-primary" />
            {t("intake.title")}
          </CardTitle>
          <CardDescription className="max-w-[70ch]">{t("intake.lead")}</CardDescription>
          {data && <p className="text-xs text-muted-foreground">{data.inboxes.length ? fmt(t("intake.inboxes"), { list: data.inboxes.join(", ") }) : t("intake.noInbox")}</p>}
        </div>
        <Can permission={P.clientManage}>
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            <MailOpen />
            {t("intake.import")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-20 w-full" />
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("intake.empty")}</p>
        ) : (
          <ul className="divide-y">
            {data.rows.slice(0, 6).map((r) => (
              <IntakeLine key={r.id} r={r} />
            ))}
          </ul>
        )}
      </CardContent>
      {picking && <ReceivedEmails onClose={() => setPicking(false)} />}
    </Card>
  )
}

function IntakeLine({ r }: { r: IntakeRow }) {
  const { t } = useT()
  const d = useDateFormat()
  const can = useCan(P.clientManage)
  const projects = useQuery(api.timesheets.overview, r.status === "no_match" && can ? {} : "skip")
  const assign = useMutation(api.timesheets.assignIntake)
  const { run, busy } = useAction()
  const [projectId, setProjectId] = useState("")
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[r.status]}>{t(`intake.status.${r.status}` as MessageKey)}</Badge>
          {r.project && <span className="font-mono text-xs">{r.project.code}</span>}
          <span className="truncate font-medium">{r.subject || "—"}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{r.fromName ? `${r.fromName} <${r.from}>` : r.from}</span>
          <span>· {d.stamp(r.receivedAt)}</span>
          {r.pdfs.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip className="size-3" />
              {r.pdfs.join(", ")}
            </span>
          )}
          {r.matchedBy && <span>· {t(`intake.by.${r.matchedBy}` as MessageKey)}</span>}
          {r.error && <span className="text-destructive">· {r.error}</span>}
        </div>
      </div>
      {r.sheetId ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={sheetHref(r.sheetId)}>{t("intake.openSheet")}</Link>
        </Button>
      ) : (
        r.status === "no_match" &&
        can && (
          <div className="flex items-center gap-2">
            <NativeSelect aria-label={t("intake.pickProject")} className="max-w-56" value={projectId} onChange={setProjectId}>
              <option value="">{t("intake.pickProject")}</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.clientName}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" disabled={busy || !projectId} onClick={() => run(() => assign({ intakeId: r.id as Id<"staffing_timesheets_intake">, projectId: projectId as Id<"staffing_projects"> }))}>
              {t("intake.assign")}
            </Button>
          </div>
        )
      )}
    </li>
  )
}

function ReceivedEmails({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const d = useDateFormat()
  const emails = useQuery(api.timesheets.listReceivedPdfEmails, {})
  const importOne = useMutation(api.timesheets.importReceivedEmail)
  const { run, busy } = useAction()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("intake.importTitle")}</DialogTitle>
          <DialogDescription>{t("intake.importLead")}</DialogDescription>
        </DialogHeader>
        {!emails ? (
          <Skeleton className="h-32 w-full" />
        ) : emails.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("intake.importNone")}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {emails.map((e) => (
              <li key={e.emailId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.subject || "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.from} → {e.inbox} · {d.stamp(e.receivedAt)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <Paperclip className="mr-0.5 inline size-3" />
                    {e.pdfs.join(", ")}
                  </div>
                </div>
                {e.intakeId ? (
                  <Badge variant="secondary">{t("intake.imported")}</Badge>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => run(() => importOne({ emailId: e.emailId }), { success: t("intake.queued") })}>
                    {t("intake.importOne")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
