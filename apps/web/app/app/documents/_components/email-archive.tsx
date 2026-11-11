"use client"
import type { EmailArchiveSettings } from "@digimuza/documents"
import { useMutation, useQuery } from "convex/react"
import { Inbox, Lock, LockOpen, Mail } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"

/** Which inboxes file their mail into the archive, and who sees it. */
export function EmailArchive({ onEditTag }: { onEditTag: (tagId: string) => void }) {
  const { t } = useT()
  const settings = useQuery(api.documents.getEmailArchive, {})
  const setStore = useMutation(api.documents.setInboxArchive)
  const { run, busy } = useAction()
  if (settings === undefined) return <Skeleton className="h-56 w-full rounded-xl" />
  return (
    <EmailArchiveView
      settings={settings}
      busy={busy}
      onEditTag={onEditTag}
      onToggle={(inboxId, store) => void run(() => setStore({ inboxId, store }), { success: store ? t("docs.email.on") : t("docs.email.off") })}
    />
  )
}

export function EmailArchiveView({
  settings,
  busy,
  onEditTag,
  onToggle,
}: {
  settings: EmailArchiveSettings
  busy: boolean
  onEditTag: (tagId: string) => void
  onToggle: (inboxId: string, store: boolean) => void
}) {
  const { t } = useT()
  return (
    <div className="grid gap-4">
      <div className="grid max-w-[70ch] gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Mail className="size-4" aria-hidden />
          {t("docs.email.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("docs.email.lead")}</p>
      </div>

      {!settings.available ? (
        <Alert>
          <Inbox />
          <AlertDescription>{t("docs.email.unavailable")}</AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert>
            {settings.tag && !settings.tag.restricted ? <LockOpen /> : <Lock />}
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{!settings.tag ? t("docs.email.tagPending") : settings.tag.restricted ? t("docs.email.tagRestricted") : t("docs.email.tagOpen")}</span>
              {settings.tag && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onEditTag(settings.tag!.id)}>
                  {t("docs.email.editTag")}
                </Button>
              )}
            </AlertDescription>
          </Alert>

          {settings.inboxes.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title={t("docs.email.empty.title")}
              body={t("docs.email.empty.body")}
              action={
                <Button variant="outline" asChild>
                  <Link href="/app/ingest/inboxes">{t("docs.email.openIngest")}</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4 text-xs font-medium text-muted-foreground">{t("docs.email.inbox")}</TableHead>
                    <TableHead className="hidden px-4 text-xs font-medium text-muted-foreground sm:table-cell">{t("docs.email.address")}</TableHead>
                    <TableHead className="w-24 px-4 text-right text-xs font-medium text-muted-foreground">{t("docs.email.store")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.inboxes.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="px-4 whitespace-normal">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{i.name}</span>
                          {i.status !== "active" && <Badge variant="secondary">{t("docs.email.disabledInbox")}</Badge>}
                        </span>
                        <span className="block font-mono text-xs break-all text-muted-foreground sm:hidden">{i.address}</span>
                        <span className="block text-xs text-muted-foreground">{i.store ? t("docs.email.on") : t("docs.email.off")}</span>
                      </TableCell>
                      <TableCell className="hidden px-4 font-mono text-xs break-all whitespace-normal sm:table-cell">{i.address}</TableCell>
                      <TableCell className="px-4 text-right">
                        <Switch
                          checked={i.store}
                          disabled={busy}
                          aria-label={`${t("docs.email.storeLabel")} ${i.name}`}
                          onCheckedChange={(store) => onToggle(i.id, store)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
