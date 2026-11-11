"use client"
import { PanelLeft } from "lucide-react"
import { useState } from "react"
import { AiChat } from "@/components/ai/chat"
import { AiThreadList } from "@/components/ai/thread-list"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import type { AiThreadId } from "@/lib/ai/types"
import { useT } from "@/lib/i18n/client"

export function ThreadView({ threadId }: { threadId: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)

  // Phones: the thread list lives in a Sheet; desktop shows it in the left column.
  const threads = (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label={t("ai.threads")}>
          <PanelLeft />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-80 gap-0 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("ai.threads")}</SheetTitle>
          <SheetDescription>{t("ai.lead")}</SheetDescription>
        </SheetHeader>
        <AiThreadList activeId={threadId} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )

  // key: a fresh runtime per conversation.
  return <AiChat key={threadId} threadId={threadId as AiThreadId} leading={threads} />
}
