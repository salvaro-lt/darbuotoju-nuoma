"use client"
// The /app pages the palette offers. Mirrors the visibility rules of the
// sidebar (app/app/nav.tsx): module on + useCan. Keep the two in step when a
// page is added. UI hint only: every page re-checks with requireSession.
import { SystemPermissions } from "@digimuza/system-core/modules"
import { FinancePermissions } from "@digimuza/system-core/finance"
import { McpPermissions } from "@digimuza/system-core/mcp"
import { useCan, useCurrentUser, useVisibleModules } from "@digimuza/system-core/react"
import { AppWindow, Bell, Bot, House, KeyRound, Mail, Plug, Receipt, ScrollText, UserRound, Users } from "lucide-react"
import type { ReactNode } from "react"
import { AI_CHAT_PERMISSION, AI_MODULE_ID } from "@/lib/ai/api"
import type { MessageKey } from "@/lib/i18n/messages"

export interface AppPage {
  href: string
  label: MessageKey
  icon: ReactNode
}

/** What the current user may open, in sidebar order. */
export function useAppPages(): AppPage[] {
  const user = useCurrentUser()
  const modules = useVisibleModules()
  const on = (id: string) => modules.some((m) => m.id === id && m.effective)
  const canFinance = useCan(FinancePermissions.read)
  const canAi = useCan(AI_CHAT_PERMISSION)
  const canUsers = useCan(SystemPermissions.usersRead)
  const canInvites = useCan(SystemPermissions.invitesRead)
  const canModules = useCan(SystemPermissions.modulesRead)
  const canAudit = useCan(SystemPermissions.auditRead)
  const canKeys = useCan(SystemPermissions.ownKeysRead)
  const canMcp = useCan(McpPermissions.create) && canAi

  const pages: (AppPage | false)[] = [
    { href: "/app", label: "nav.home", icon: <House /> },
    on("finance") && canFinance && { href: "/app/finance", label: "nav.finance", icon: <Receipt /> },
    on(AI_MODULE_ID) && canAi && { href: "/app/ai", label: "nav.ai", icon: <Bot /> },
    canUsers && { href: "/app/admin/users", label: "nav.users", icon: <Users /> },
    canInvites && { href: "/app/admin/invites", label: "nav.invites", icon: <Mail /> },
    canModules && { href: "/app/admin/modules", label: "nav.modules", icon: <AppWindow /> },
    canAudit && { href: "/app/admin/audit", label: "nav.audit", icon: <ScrollText /> },
    !!user && { href: "/app/account", label: "nav.account", icon: <UserRound /> },
    !!user && { href: "/app/settings/notifications", label: "nav.notifications", icon: <Bell /> },
    canKeys && { href: "/app/settings/api-keys", label: "nav.apiKeys", icon: <KeyRound /> },
    on("mcp") && canMcp && { href: "/app/settings/mcp", label: "nav.mcp", icon: <Plug /> },
  ]
  return pages.filter((p): p is AppPage => p !== false)
}
