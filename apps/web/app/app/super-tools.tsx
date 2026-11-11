"use client"
import { useRoleView } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ChevronDown, Eye, EyeOff, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useSyncExternalStore, type FormEvent } from "react"
import { RoleSelect } from "@/components/app/role-select"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"

// Minimised/expanded, remembered per browser.
const KEY = "super-toolbar-minimized"
const listeners = new Set<() => void>()
function useMinimized(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => localStorage.getItem(KEY) === "1",
    () => false,
  )
  return [
    value,
    (v) => {
      localStorage.setItem(KEY, v ? "1" : "0")
      listeners.forEach((l) => l())
    },
  ]
}

/**
 * Floating Super admin toolbar, bottom right, over the page. Only for a real
 * Super (also while previewing a role, so there is always a way back).
 * Built from shadcn Card, Badge and Button; a preview shows as a primary badge.
 */
export function SuperToolbar() {
  const { t } = useT()
  // canViewAs / roleView come with the live session (system-core view as role).
  const { canViewAs, roleView: viewing } = useRoleView()
  const stop = useMutation(api.system.stopRoleView)
  const { run, busy } = useAction()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useMinimized()
  if (!canViewAs) return null

  async function back() {
    if (await run(() => stop({}), { success: t("super.stopped") })) router.refresh()
  }

  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] justify-end">
        {minimized ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-lg"
                variant={viewing ? "default" : "outline"}
                className="pointer-events-auto rounded-full shadow-lg"
                onClick={() => setMinimized(false)}
                aria-label={t("super.expand")}
              >
                {viewing ? <Eye /> : <ShieldCheck />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{viewing ? `${t("super.viewing")}: ${viewing.roleName}` : t("super.expand")}</TooltipContent>
          </Tooltip>
        ) : (
          <Card role="toolbar" aria-label={t("super.tools")} className="pointer-events-auto flex-row items-center gap-1 rounded-full p-1 pl-3 shadow-lg">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="size-4" />
              <span className="hidden sm:inline">Super</span>
            </span>
            <Separator orientation="vertical" className="mx-1 h-5" />
            {viewing ? (
              <>
                <Badge className="max-w-48 truncate">
                  <Eye />
                  {viewing.roleName}
                </Badge>
                <span className="hidden px-1 text-xs text-muted-foreground md:inline">{t("super.bannerHint")}</span>
                <Button size="sm" className="rounded-full" disabled={busy} onClick={() => void back()}>
                  <EyeOff />
                  {t("super.stop")}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setOpen(true)}>
                <Eye />
                {t("super.viewAs")}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="rounded-full" onClick={() => setMinimized(true)} aria-label={t("super.minimize")}>
                  <ChevronDown />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("super.minimize")}</TooltipContent>
            </Tooltip>
          </Card>
        )}
      </div>
      <ViewAsDialog open={open && !viewing} onOpenChange={setOpen} current="" />
    </>
  )
}

function ViewAsDialog({ open, onOpenChange, current }: { open: boolean; onOpenChange: (v: boolean) => void; current: string }) {
  const { t } = useT()
  const router = useRouter()
  // Only opened outside a preview: during one the Super acts as the role and
  // can't list roles, so "Back to Super" comes first.
  const roles = useQuery(api.system.listRoles, open ? { limit: 100 } : "skip")
  const start = useMutation(api.system.startRoleView)
  const { run, busy } = useAction()
  const [roleId, setRoleId] = useState(current)
  const options = (roles?.items ?? []).filter((r) => !r.archived && r.key !== "system:profile")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => start({ roleId }), { success: t("super.started") })
    if (res) {
      onOpenChange(false)
      router.push("/app")
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("super.viewAsTitle")}</DialogTitle>
            <DialogDescription>{t("super.viewAsBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="view-role">{t("common.role")}</FieldLabel>
            <RoleSelect id="view-role" roles={options} value={roleId} onChange={setRoleId} placeholder={t("common.role")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !roleId || roleId === current}>
              <Eye />
              {t("super.start")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
