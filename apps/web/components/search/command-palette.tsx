"use client"
// Global search / command palette (DIG-72). ⌘K / Ctrl+K anywhere under /app.
// Groups: recent (empty query), pages, records (api.search.search), actions,
// ask the assistant. What is offered is a UI hint: pages re-check with
// requireSession and every Convex call re-checks permissions on the server.
import { FinancePermissions } from "@digimuza/system-core/finance"
import { useCan, useCurrentUser, useVisibleModules } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { ArrowDown, ArrowUp, Bot, CornerDownLeft, FileText, Languages, Loader2, Plus, Receipt, RotateCw, Search, SquarePen, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { useAction } from "@/components/app/use-action"
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { AI_CHAT_PERMISSION, AI_MODULE_ID, aiApi } from "@/lib/ai/api"
import { setLocale } from "@/lib/i18n/actions"
import { useT } from "@/lib/i18n/client"
import { LOCALES, MESSAGES, type MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { useAppPages } from "./pages"
import { openPalette, setPaletteOpen, togglePalette, useModKey, usePaletteOpen } from "./palette-store"
import { useRecent, type RecentItem } from "./recent"
import { SEARCH_MAX, SEARCH_MIN, useRecordSearch } from "./use-record-search"

/** Mounted once in app/app/layout.tsx: the dialog and the global shortcut. */
export function CommandPalette() {
  const { t } = useT()
  const open = usePaletteOpen()
  // A fresh body (empty query, first item selected) each time the palette opens.
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession((s) => s + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing) return
      e.preventDefault()
      if (!e.repeat) togglePalette()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setPaletteOpen} title={t("search.title")} description={t("search.description")} className="sm:max-w-xl">
      <PaletteBody key={session} />
    </CommandDialog>
  )
}

/** Sidebar header entry: "Ieškoti…" with the shortcut; an icon with a tooltip when the sidebar is collapsed. */
export function SearchNavButton() {
  const { t } = useT()
  const mod = useModKey()
  const shortcut = mod === "⌘" ? "⌘K" : mod ? "Ctrl+K" : null
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={shortcut ? `${t("search.title")} · ${shortcut}` : t("search.title")}
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="text-muted-foreground"
      >
        <Search />
        <span>{t("search.button")}</span>
        {shortcut && <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">{shortcut}</Kbd>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-sm border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground [&_svg]:size-3", className)}>
      {children}
    </kbd>
  )
}

const fold = (s: string, locale: string) =>
  s
    .toLocaleLowerCase(locale)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")

const recordIcon = (kind: string | undefined) => (kind === "invoice" ? <Receipt /> : <FileText />)

function PaletteBody() {
  const { t, locale } = useT()
  const router = useRouter()
  const user = useCurrentUser()
  const pages = useAppPages()
  const modules = useVisibleModules()
  const on = (id: string) => modules.some((m) => m.id === id && m.effective)
  const canAi = useCan(AI_CHAT_PERMISSION)
  const canCreateInvoice = useCan(FinancePermissions.create)
  const aiOn = on(AI_MODULE_ID) && canAi
  const [query, setQuery] = useState("")
  const records = useRecordSearch(query, true)
  const recent = useRecent(user?.userId)
  const { run, busy } = useAction()
  const createThread = useMutation(aiApi.createThread)
  const sendMessage = useMutation(aiApi.sendMessage)

  const text = query.trim()
  const needle = fold(text, locale)
  const matches = (label: string) => !needle || fold(label, locale).includes(needle)
  const otherLocale = LOCALES.find((l) => l !== locale)

  function close() {
    setPaletteOpen(false)
  }

  function open(href: string, item: RecentItem) {
    recent.remember(item)
    close()
    router.push(href)
  }

  async function startChat(message?: string) {
    const created = await run(() => createThread({}))
    if (!created) return
    // The thread exists even if sending fails; open it so the text can be sent again there.
    if (message) await run(() => sendMessage({ threadId: created.threadId, text: message }))
    close()
    router.push(`/app/ai/${created.threadId}`)
  }

  async function switchLocale(l: string) {
    const fd = new FormData()
    fd.set("locale", l)
    close()
    await run(() => setLocale(fd))
    router.refresh()
  }

  const actions: { id: string; label: string; icon: ReactNode; run: () => void }[] = [
    ...(on("finance") && canCreateInvoice
      ? [{ id: "new-invoice", label: t("search.action.newInvoice"), icon: <Plus />, run: () => open("/app/finance?new=1", { type: "page", href: "/app/finance" }) }]
      : []),
    ...(aiOn ? [{ id: "new-chat", label: t("search.action.newChat"), icon: <SquarePen />, run: () => void startChat() }] : []),
    ...(otherLocale
      ? [{ id: "language", label: `${t("search.action.language")}: ${MESSAGES[otherLocale]["lang.name"]}`, icon: <Languages />, run: () => void switchLocale(otherLocale) }]
      : []),
  ].filter((a) => matches(a.label))

  const pageLabel = (href: string) => {
    const p = pages.find((x) => x.href === href)
    return p ? { ...p, text: t(p.label) } : undefined
  }
  const shownPages = pages.map((p) => ({ ...p, text: t(p.label) })).filter((p) => matches(p.text))
  const shownRecent = text
    ? []
    : recent.items.flatMap((r): { key: string; item: RecentItem; icon: ReactNode; title: string; subtitle: string | undefined }[] => {
        if (r.type === "page") {
          const p = pageLabel(r.href)
          return p ? [{ key: r.href, item: r, icon: p.icon, title: p.text, subtitle: undefined }] : []
        }
        return [{ key: r.href, item: r, icon: recordIcon(r.kind), title: r.title, subtitle: r.subtitle }]
      })

  const groupLabel = (providerId: string, fallback: string) => {
    const key = `search.provider.${providerId}` as MessageKey
    return key in MESSAGES[locale] ? t(key) : fallback
  }
  const hits = records.failed ? [] : (records.result?.groups ?? [])
  const recordsDone = records.active && !records.loading && !records.failed
  const noRecords = recordsDone && (records.result?.total ?? 0) === 0
  const showAsk = aiOn && text.length > 0
  const nothing = !!text && shownPages.length === 0 && actions.length === 0 && hits.length === 0 && !showAsk && (noRecords || text.length < SEARCH_MIN)

  // Item values in render order. The selection jumps to the first item whenever the
  // query or the record results change (cmdk does not reselect when filtering is off).
  const order = [
    ...shownRecent.map((r) => `recent:${r.key}`),
    ...shownPages.map((p) => `page:${p.href}`),
    ...hits.flatMap((g) => g.hits.map((h) => `record:${h.providerId}:${h.id}`)),
    ...(records.failed && hits.length === 0 ? ["records:retry"] : []),
    ...actions.map((a) => `action:${a.id}`),
    ...(showAsk ? ["ask"] : []),
  ]
  const first = order[0] ?? ""
  const resultKey = `${text}\u0000${records.result?.query ?? ""}\u0000${records.failed}`
  const [selected, setSelected] = useState(first)
  const [seenKey, setSeenKey] = useState(resultKey)
  if (seenKey !== resultKey) {
    setSeenKey(resultKey)
    setSelected(first)
  }
  const value = order.includes(selected) ? selected : first

  const status = records.loading ? t("search.loading") : recordsDone ? `${t("search.found")} ${records.result?.total ?? 0}` : ""

  return (
    <Command shouldFilter={false} loop value={value} onValueChange={setSelected} className="rounded-none! p-0">
      <CommandInput value={query} onValueChange={setQuery} placeholder={t("search.placeholder")} maxLength={SEARCH_MAX} />
      <CommandList className="max-h-[min(60vh,26rem)] scroll-py-2 px-1 pt-1 pb-1">
        {shownRecent.length > 0 && (
          <CommandGroup heading={t("search.group.recent")}>
            {shownRecent.map((r) => (
              <CommandItem key={r.key} value={`recent:${r.key}`} onSelect={() => open(r.item.href, r.item)}>
                {r.icon}
                <ItemText title={r.title} subtitle={r.subtitle} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {shownPages.length > 0 && (
          <CommandGroup heading={t("search.group.pages")}>
            {shownPages.map((p) => (
              <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => open(p.href, { type: "page", href: p.href })}>
                {p.icon}
                <ItemText title={p.text} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hits.map((g) => (
          <CommandGroup key={g.providerId} heading={groupLabel(g.providerId, g.label)} className={cn(records.loading && "opacity-60 transition-opacity")}>
            {g.hits.map((h) => (
              <CommandItem
                key={`${h.providerId}:${h.id}`}
                value={`record:${h.providerId}:${h.id}`}
                onSelect={() => open(h.href, { type: "record", href: h.href, title: h.title, subtitle: h.subtitle, providerId: h.providerId, kind: h.kind })}
              >
                {recordIcon(h.kind)}
                <ItemText title={h.title} subtitle={h.subtitle} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {text.length > 0 && hits.length === 0 && !nothing && (
          <CommandGroup heading={t("search.group.records")}>
            {text.length < SEARCH_MIN ? (
              <StatusRow>{t("search.minChars")}</StatusRow>
            ) : records.failed ? (
              <>
                <StatusRow icon={<TriangleAlert className="text-destructive" />}>{t("search.error")}</StatusRow>
                <CommandItem value="records:retry" onSelect={records.retry}>
                  <RotateCw />
                  {t("search.retry")}
                </CommandItem>
              </>
            ) : records.loading ? (
              <StatusRow icon={<Loader2 className="animate-spin" />}>{t("search.loading")}</StatusRow>
            ) : (
              <StatusRow>{t("search.noRecords")}</StatusRow>
            )}
          </CommandGroup>
        )}

        {actions.length > 0 && (
          <CommandGroup heading={t("search.group.actions")}>
            {actions.map((a) => (
              <CommandItem key={a.id} value={`action:${a.id}`} disabled={busy} onSelect={a.run}>
                {a.icon}
                <ItemText title={a.label} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showAsk && (
          <>
            <CommandSeparator className="mx-0 my-1" />
            <CommandGroup heading={t("search.group.ask")}>
              <CommandItem value="ask" disabled={busy} onSelect={() => void startChat(text)}>
                {busy ? <Loader2 className="animate-spin" /> : <Bot />}
                <span className="shrink-0">{busy ? t("search.asking") : t("search.ask")}</span>
                <span className="min-w-0 truncate text-muted-foreground">{locale === "lt" ? `„${text}“` : `“${text}”`}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {nothing && (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <p className="text-sm font-medium">{t("search.empty")}</p>
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">{t("search.emptyHint")}</p>
          </div>
        )}
      </CommandList>

      <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 max-sm:hidden">
          <Kbd>
            <ArrowUp />
          </Kbd>
          <Kbd>
            <ArrowDown />
          </Kbd>
          {t("search.hint.navigate")}
        </span>
        <span className="flex items-center gap-1.5 max-sm:hidden">
          <Kbd>
            <CornerDownLeft />
          </Kbd>
          {t("search.hint.open")}
        </span>
        <span className="flex items-center gap-1.5 max-sm:hidden">
          <Kbd>Esc</Kbd>
          {t("search.hint.close")}
        </span>
        <span role="status" aria-live="polite" className="ml-auto flex items-center gap-1.5 tabular-nums">
          {records.loading && <Loader2 className="size-3 animate-spin" />}
          {status}
        </span>
      </div>
    </Command>
  )
}

function ItemText({ title, subtitle }: { title: string; subtitle?: string | undefined }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate">{title}</span>
      {subtitle && <span className="ml-auto max-w-[55%] truncate text-xs text-muted-foreground group-data-selected/command-item:text-foreground/70">{subtitle}</span>}
    </span>
  )
}

function StatusRow({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      {children}
    </div>
  )
}
