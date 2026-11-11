"use client"
import { SUBMISSION_STATUSES, type SubmissionStatus } from "@digimuza/documents/signing"
import { useQuery } from "convex/react"
import { FileStack, Signature } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { submissionHref, useSigningVisible } from "../../_components/use-documents"
import { SignerDot, SubmissionBadge } from "./status"

export function SubmissionsList() {
  const { t, locale } = useT()
  const router = useRouter()
  const visible = useSigningVisible()
  const [status, setStatus] = useState<SubmissionStatus | "all">("all")
  const rows = useQuery(api.documents.listSubmissions, visible ? (status === "all" ? {} : { status }) : "skip")

  if (!visible) return <p className="text-sm text-muted-foreground">{t("sign.off")}</p>

  return (
    <>
      <PageHeader
        title={t("sign.submissions.title")}
        lead={t("sign.submissions.lead")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/documents/templates">
              <FileStack /> {t("nav.templates")}
            </Link>
          </Button>
        }
      />
      <Tabs value={status} onValueChange={(v) => setStatus(v as SubmissionStatus | "all")} className="mb-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="all">{t("sign.status.all")}</TabsTrigger>
          {SUBMISSION_STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`sign.status.${s}` as MessageKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {rows === undefined ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Signature />}
          title={status === "all" ? t("sign.submissions.empty") : t("sign.submissions.emptyFiltered")}
          body={status === "all" ? t("sign.submissions.emptyBody") : undefined}
          action={
            status === "all" ? (
              <Button asChild>
                <Link href="/app/documents/templates">{t("sign.submissions.toTemplates")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sign.submissions.document")}</TableHead>
                <TableHead>{t("sign.submissions.signers")}</TableHead>
                <TableHead>{t("sign.submissions.status")}</TableHead>
                <TableHead>{t("sign.submissions.sent")}</TableHead>
                <TableHead>{t("sign.submissions.completed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const done = s.submitters.filter((x) => x.status === "completed").length
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(submissionHref(s.id))}>
                    <TableCell className="max-w-80">
                      <Link href={submissionHref(s.id)} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.name}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{s.createdByName}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-96 flex-wrap items-center gap-x-3 gap-y-1">
                        {s.submitters.map((x) => (
                          <span key={x.id} className="inline-flex min-w-0 items-center gap-1.5 text-sm">
                            <SignerDot status={x.status} />
                            <span className="truncate">{x.name || x.email}</span>
                          </span>
                        ))}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {done}/{s.submitters.length}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SubmissionBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDate(s.createdAt, locale)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{s.completedAt ? formatDate(s.completedAt, locale) : "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
