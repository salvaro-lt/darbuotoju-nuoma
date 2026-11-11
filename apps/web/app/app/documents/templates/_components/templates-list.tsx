"use client"
import type { TemplateView } from "@digimuza/documents"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Archive, ArchiveRestore, FileStack, MoreHorizontal, PenSquare, Plus, Send } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { roleColor } from "@/components/documents/signing-fields"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { openPdf, pageSizes, uploadBlob } from "@/lib/documents/pdf"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { templateHref, useSigningVisible } from "../../_components/use-documents"
import { SendDialog } from "./send-dialog"

const MAX_PDF = 50 * 1024 * 1024

/** Signing templates: upload a PDF, place fields in the builder, send. */
export function TemplatesList() {
  const { t, locale } = useT()
  const router = useRouter()
  const visible = useSigningVisible()
  const canTemplates = useCan(DocumentsPermissions.manageTemplates)
  const canSend = useCan(DocumentsPermissions.signingSend)
  const [archived, setArchived] = useState(false)
  const templates = useQuery(api.documents.listTemplates, visible ? { archived } : "skip")
  const uploadUrl = useMutation(api.documents.generateTemplateUploadUrl)
  const create = useMutation(api.documents.createTemplate)
  const setArchivedM = useMutation(api.documents.setTemplateArchived)
  const { run, busy } = useAction()
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState<TemplateView | null>(null)
  const file = useRef<HTMLInputElement>(null)

  async function upload(f: File) {
    if (f.type !== "application/pdf") return toast.error(t("sign.templates.onlyPdf"))
    if (f.size > MAX_PDF) return toast.error(t("sign.templates.tooLarge"))
    setUploading(true)
    try {
      const bytes = await f.arrayBuffer()
      // Read the pages first: a broken PDF never reaches storage.
      const pdf = await openPdf(bytes.slice(0)).catch(() => null)
      if (!pdf) return void toast.error(t("sign.templates.unreadable"))
      const pages = await pageSizes(pdf)
      void pdf.cleanup()
      const res = await run(async () => {
        const storageId = await uploadBlob(await uploadUrl({}), f)
        return create({ name: f.name.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim() || f.name, storageId: storageId as Id<"_storage">, fileName: f.name, pages })
      })
      if (res) router.push(templateHref(res.templateId))
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ""
    }
  }

  if (!visible) return <p className="text-sm text-muted-foreground">{t("sign.off")}</p>

  return (
    <>
      <PageHeader
        title={t("sign.templates.title")}
        lead={t("sign.templates.lead")}
        actions={
          canTemplates && (
            <>
              <input ref={file} type="file" accept="application/pdf" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button disabled={uploading || busy} onClick={() => file.current?.click()}>
                <Plus /> {uploading ? t("sign.templates.uploading") : t("sign.templates.new")}
              </Button>
            </>
          )
        }
      />
      <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")} className="mb-4">
        <TabsList>
          <TabsTrigger value="active">{t("sign.templates.active")}</TabsTrigger>
          <TabsTrigger value="archived">{t("sign.templates.archived")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {templates === undefined ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title={archived ? t("sign.templates.emptyArchived") : t("sign.templates.empty")}
          body={archived ? undefined : t("sign.templates.emptyBody")}
          action={
            !archived && canTemplates ? (
              <Button disabled={uploading} onClick={() => file.current?.click()}>
                <Plus /> {t("sign.templates.new")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sign.templates.name")}</TableHead>
                <TableHead>{t("sign.templates.roles")}</TableHead>
                <TableHead className="text-right">{t("sign.templates.fields")}</TableHead>
                <TableHead className="text-right">{t("sign.templates.sent")}</TableHead>
                <TableHead>{t("sign.templates.updated")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((tpl) => (
                <TableRow key={tpl.id} className="cursor-pointer" onClick={() => router.push(templateHref(tpl.id))}>
                  <TableCell className="max-w-80">
                    <Link href={templateHref(tpl.id)} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {tpl.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tpl.fileName} · {tpl.pages.length} {t("sign.pagesShort")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {tpl.roles.map((r, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                          <span className="size-2 rounded-full" style={{ background: roleColor(i) }} aria-hidden="true" />
                          {r}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{tpl.fields.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{tpl.submissions}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatDate(tpl.updatedAt, locale)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t("sign.actions")}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canSend && !tpl.archived && (
                          <DropdownMenuItem disabled={tpl.fields.length === 0} onSelect={() => setSending(tpl)}>
                            <Send /> {t("sign.send.action")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                          <Link href={templateHref(tpl.id)}>
                            <PenSquare /> {canTemplates ? t("sign.templates.edit") : t("sign.templates.view")}
                          </Link>
                        </DropdownMenuItem>
                        {canTemplates && (
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(() => setArchivedM({ templateId: tpl.id, archived: !tpl.archived }), {
                                success: tpl.archived ? t("sign.templates.restored") : t("sign.templates.archivedToast"),
                              })
                            }
                          >
                            {tpl.archived ? <ArchiveRestore /> : <Archive />}
                            {tpl.archived ? t("sign.templates.restore") : t("sign.templates.archive")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {sending && (
        <SendDialog
          key={sending.id}
          open
          onOpenChange={(o) => !o && setSending(null)}
          templateId={sending.id}
          templateName={sending.name}
          roles={sending.roles}
          rolesWithFields={[...new Set(sending.fields.map((f) => f.role))]}
        />
      )}
    </>
  )
}
