"use client"
import { useAction as useConvexAction, useQuery } from "convex/react"
import { CheckCircle2, Clock, Copy, Loader2, Plug, SlidersHorizontal } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import { useAction } from "@/components/app/use-action"
import { CopyButton } from "@/components/audit/copy-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { brand } from "@/brand"
import { api } from "@/convex/_generated/api"
import { formatTime } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { useMcpAccess, useMcpSiteUrl } from "./mcp-context"

type CreatedLink = { linkId: string; url: string; expiresAt: number }

/** Server name for `claude mcp add`: the brand, ASCII, kebab-case. */
const serverSlug = () =>
  brand.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "assistant"

/**
 * "Connect ChatGPT or Claude": the button plus the whole flow (roles → one-time
 * link shown once, live status, instructions). Renders nothing without access.
 */
export function ConnectMcpButton({ children, ...props }: Omit<React.ComponentProps<typeof Button>, "onClick"> & { children?: ReactNode }) {
  const { t } = useT()
  const { canConnect } = useMcpAccess()
  const siteUrl = useMcpSiteUrl()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<CreatedLink | null>(null)
  if (!canConnect) return null
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>
        {children ?? (
          <>
            <Plug />
            {t("mcp.new")}
          </>
        )}
      </Button>
      <NewLinkDialog open={open} onOpenChange={setOpen} onCreated={(l) => setLink({ linkId: l.linkId, expiresAt: l.expiresAt, url: `${siteUrl}${l.path}` })} />
      <LinkDialog link={link} onDone={() => setLink(null)} />
    </>
  )
}

/**
 * One click: a fresh one-time link with all the roles the person may put on it
 * (capped as usual), copied to the clipboard, and a toast. The slider button
 * opens the dialog to narrow the roles or name the link. If the browser blocks
 * the clipboard, the link is shown once in the dialog instead.
 */
export function CopyMcpLinkButton({ className, variant = "outline", withOptions = true }: { className?: string; variant?: "outline" | "default"; withOptions?: boolean }) {
  const { t } = useT()
  const { canConnect } = useMcpAccess()
  const siteUrl = useMcpSiteUrl()
  const roles = useQuery(api.mcp.listMcpRoles, canConnect ? {} : "skip")
  const create = useConvexAction(api.mcp.createMcpLink)
  const { run, busy } = useAction()
  const [options, setOptions] = useState(false)
  const [link, setLink] = useState<CreatedLink | null>(null)
  if (!canConnect) return null

  async function copy() {
    const res = await run(() => create({ roleIds: (roles ?? []).map((r) => r.id) }))
    if (!res) return
    const created = { linkId: res.linkId, expiresAt: res.expiresAt, url: `${siteUrl}${res.path}` }
    try {
      await navigator.clipboard.writeText(created.url)
      toast.success(t("ai.mcp.copied"))
    } catch {
      setLink(created)
    }
  }

  return (
    <div className={cn("flex min-w-0 gap-2", className)}>
      <Button type="button" variant={variant} className="min-w-0 flex-1" disabled={busy || roles === undefined} onClick={() => void copy()}>
        {busy ? <Loader2 className="animate-spin" /> : <Copy />}
        <span className="truncate">{t("ai.mcp.copyLink")}</span>
      </Button>
      {withOptions && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={t("ai.mcp.moreOptions")} onClick={() => setOptions(true)}>
              <SlidersHorizontal />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ai.mcp.moreOptions")}</TooltipContent>
        </Tooltip>
      )}
      <NewLinkDialog open={options} onOpenChange={setOptions} onCreated={(l) => setLink({ linkId: l.linkId, expiresAt: l.expiresAt, url: `${siteUrl}${l.path}` })} />
      <LinkDialog link={link} onDone={() => setLink(null)} />
    </div>
  )
}

export function NewLinkDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (l: { linkId: string; path: string; expiresAt: number }) => void }) {
  const { t } = useT()
  const roles = useQuery(api.mcp.listMcpRoles, open ? {} : "skip")
  const create = useConvexAction(api.mcp.createMcpLink)
  const { run, busy } = useAction()
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string[] | null>(null)
  // Default: every role that allows the assistant.
  const roleIds = picked ?? (roles ?? []).filter((r) => r.grantsChat).map((r) => r.id)
  const hasChat = (roles ?? []).some((r) => r.grantsChat && roleIds.includes(r.id))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => create({ roleIds, ...(name.trim() ? { name: name.trim() } : {}) }))
    if (!res) return
    setName("")
    setPicked(null)
    onOpenChange(false)
    onCreated(res)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("mcp.newTitle")}</DialogTitle>
            <DialogDescription>{t("mcp.newLead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mcp-name">{t("mcp.name")}</FieldLabel>
              <Input id="mcp-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              <FieldDescription>{t("mcp.nameHelp")}</FieldDescription>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">{t("mcp.roles")}</FieldLegend>
              <FieldDescription>{t("mcp.rolesHelp")}</FieldDescription>
              {roles && !roles.some((r) => r.grantsChat) ? (
                <p className="text-sm text-destructive">{t("mcp.noRoles")}</p>
              ) : (
                <div className="grid gap-2">
                  {(roles ?? []).map((r) => (
                    <Label key={r.id} className="flex items-center gap-2 font-normal">
                      <Checkbox checked={roleIds.includes(r.id)} onCheckedChange={(v) => setPicked(v ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id))} />
                      <span>{r.name}</span>
                      {!r.grantsChat && <span className="text-xs text-muted-foreground">({t("mcp.roleNoChat")})</span>}
                    </Label>
                  ))}
                </div>
              )}
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !hasChat}>
              {busy && <Loader2 className="animate-spin" />}
              {t("mcp.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The link, exactly once, with live redemption status and how to add it in each client. */
export function LinkDialog({ link, onDone }: { link: CreatedLink | null; onDone: () => void }) {
  const { t, locale } = useT()
  const status = useQuery(api.mcp.getMcpLinkStatus, link ? { linkId: link.linkId } : "skip")
  const command = link ? `claude mcp add --transport http ${serverSlug()} ${link.url}` : ""

  return (
    <Dialog open={!!link}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("mcp.link.title")}</DialogTitle>
          <DialogDescription>{link ? t("mcp.link.body").replace("{time}", formatTime(link.expiresAt, locale)) : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted p-3">
          <code className="flex-1 break-all font-mono text-[13px]">{link?.url}</code>
          {link && <CopyButton value={link.url} label={t("mcp.link.copy")} />}
        </div>
        <p aria-live="polite" className="flex items-center gap-2 text-sm">
          {status?.status === "redeemed" ? (
            <>
              <CheckCircle2 className="size-4 text-primary" />
              <span className="font-medium">{t("mcp.link.connected").replace("{client}", status.clientName ?? "")}</span>
            </>
          ) : status?.status === "expired" ? (
            <>
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("mcp.link.expired")}</span>
            </>
          ) : (
            <>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">{t("mcp.link.waiting")}</span>
            </>
          )}
        </p>
        <div className="grid gap-4 text-sm">
          <HowTo title={t("mcp.how.chatgpt")} body={t("mcp.how.chatgpt.body")} />
          <HowTo title={t("mcp.how.claude")} body={t("mcp.how.claude.body")} />
          <HowTo title={t("mcp.how.claudeCode")} body={t("mcp.how.claudeCode.body")}>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs">{command}</code>
              <CopyButton value={command} label={t("mcp.how.copyCommand")} />
            </div>
          </HowTo>
        </div>
        <DialogFooter>
          <Button onClick={onDone}>{t("mcp.link.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HowTo({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="font-medium">{title}</h3>
      <p className="text-muted-foreground">{body}</p>
      {children}
    </section>
  )
}
