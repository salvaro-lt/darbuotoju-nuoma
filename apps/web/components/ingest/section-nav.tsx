"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

/** Integracijos · Pašto dėžutės · Gauti laiškai */
export function IngestSectionNav() {
  const { t } = useT()
  const path = usePathname()
  const links = [
    { href: "/app/ingest", label: t("ingest.nav.integrations"), active: path === "/app/ingest" },
    { href: "/app/ingest/inboxes", label: t("ingest.nav.inboxes"), active: path.startsWith("/app/ingest/inboxes") },
    { href: "/app/ingest/emails", label: t("ingest.nav.emails"), active: path.startsWith("/app/ingest/emails") },
  ]
  return (
    <nav aria-label={t("nav.ingest")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.active ? "page" : undefined}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
            l.active && "border-primary font-medium text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
