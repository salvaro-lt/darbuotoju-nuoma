"use client"
import { systemErrorOf } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { Check, CircleAlert, Copy, FileUp, Loader2, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { MAX_UPLOAD, prepareFile } from "@/lib/documents/upload"
import { uploadBlob } from "@/lib/documents/pdf"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { documentHref } from "./use-documents"

type Stage = "reading" | "uploading" | "filing" | "done" | "duplicate" | "failed"

interface Item {
  key: string
  name: string
  stage: Stage
  documentId?: string
  error?: string
}

/** Files one file after another (keeps pdf.js memory and the upload bandwidth calm). */
export function useUploader() {
  const { t } = useT()
  const router = useRouter()
  const uploadUrl = useMutation(api.documents.generateUploadUrl)
  const create = useMutation(api.documents.createDocument)
  const [items, setItems] = useState<Item[]>([])

  const upload = useCallback(
    async (files: File[]) => {
      const set = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
      const queued = files.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }))
      setItems((xs) => [...queued.map((q) => ({ key: q.key, name: q.file.name, stage: "reading" as Stage })), ...xs].slice(0, 30))
      for (const { file, key } of queued) {
        if (file.size > MAX_UPLOAD) {
          set(key, { stage: "failed", error: t("docs.upload.tooLarge") })
          continue
        }
        try {
          const prepared = await prepareFile(file)
          set(key, { stage: "uploading" })
          const storageId = await uploadBlob(await uploadUrl({}), file)
          const thumbnailId = prepared.thumbnail ? await uploadBlob(await uploadUrl({}), prepared.thumbnail) : undefined
          const ocrImageIds: string[] = []
          for (const img of prepared.ocrImages) ocrImageIds.push(await uploadBlob(await uploadUrl({}), img))
          set(key, { stage: "filing" })
          const res = await create({
            storageId: storageId as Id<"_storage">,
            fileName: file.name,
            ...(prepared.content ? { content: prepared.content } : {}),
            ...(prepared.pageCount ? { pageCount: prepared.pageCount } : {}),
            ...(thumbnailId ? { thumbnailId: thumbnailId as Id<"_storage"> } : {}),
            ...(ocrImageIds.length ? { ocrImageIds: ocrImageIds as Id<"_storage">[] } : {}),
          })
          if (res.duplicateOf) {
            set(key, { stage: "duplicate", documentId: res.duplicateOf })
            toast(t("docs.upload.duplicateToast"), { description: file.name, action: { label: t("docs.upload.open"), onClick: () => router.push(documentHref(res.duplicateOf!)) } })
          } else set(key, { stage: "done", documentId: res.documentId })
        } catch (e) {
          const se = systemErrorOf(e)
          set(key, { stage: "failed", error: se ? t(`error.${se.code}` as MessageKey) : t("error.unknown") })
        }
      }
    },
    [create, uploadUrl, router, t],
  )

  return { items, upload, clear: () => setItems([]), busy: items.some((x) => x.stage === "reading" || x.stage === "uploading" || x.stage === "filing") }
}

const ICON: Record<Stage, React.ReactNode> = {
  reading: <Loader2 className="size-3.5 animate-spin text-muted-foreground" />,
  uploading: <Loader2 className="size-3.5 animate-spin text-muted-foreground" />,
  filing: <Loader2 className="size-3.5 animate-spin text-muted-foreground" />,
  done: <Check className="size-3.5 text-primary" />,
  duplicate: <Copy className="size-3.5 text-muted-foreground" />,
  failed: <CircleAlert className="size-3.5 text-destructive" />,
}

/** Progress of the current uploads, bottom right, above the page. */
export function UploadPanel({ items, busy, onClose }: { items: Item[]; busy: boolean; onClose: () => void }) {
  const { t } = useT()
  if (items.length === 0) return null
  return (
    <section aria-live="polite" aria-label={t("docs.upload.title")} className="fixed right-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover text-popover-foreground shadow-lg">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <FileUp className="size-4 text-muted-foreground" aria-hidden />
          {t("docs.upload.title")}
        </h2>
        <Button variant="ghost" size="icon-xs" aria-label={t("docs.upload.close")} disabled={busy} onClick={onClose}>
          <X />
        </Button>
      </header>
      <ul className="max-h-64 overflow-y-auto py-1">
        {items.map((x) => (
          <li key={x.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="shrink-0">{ICON[x.stage]}</span>
            <span className="min-w-0 flex-1">
              {x.documentId ? (
                <Link href={documentHref(x.documentId)} className="block truncate underline-offset-2 hover:underline">
                  {x.name}
                </Link>
              ) : (
                <span className="block truncate">{x.name}</span>
              )}
              <span className={cn("block text-xs", x.stage === "failed" ? "text-destructive" : "text-muted-foreground")}>{x.error ?? t(`docs.upload.${x.stage}` as MessageKey)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
