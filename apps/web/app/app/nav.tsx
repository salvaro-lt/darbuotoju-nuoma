"use client"
import { SystemPermissions } from "@digimuza/system-core/modules"
import { useCan, useCurrentUser, useVisibleModules } from "@digimuza/system-core/react"
import { AppWindow, Bell, Bot, Building2, Check, FolderKanban, HardHat, Library, ChevronsUpDown, Database, FileStack, Files, House, KeyRound, Languages, ListFilter, LogOut, Mail, Mailbox, Plug, Receipt, ScrollText, Signature, Tags, UserRound, Users, Workflow } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { signOutAction } from "@/app/login/actions"
import { brand } from "@/brand"
import { BrandMark } from "@/components/brand-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { setLocale } from "@/lib/i18n/actions"
import { useT } from "@/lib/i18n/client"
import { LOCALES, MESSAGES } from "@/lib/i18n/messages"
import { FinancePermissions } from "@digimuza/system-core/finance"
import { McpPermissions } from "@digimuza/system-core/mcp"
import { CrmPermissions } from "@digimuza/crm/manifest"
import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { useStaffingEnabled } from "./staffing/_components/staffing-ui"
import { ComplianceNavItem } from "./compliance/_components/compliance-ui"
import { useDocumentsEnabled, useLabels, useSigningVisible } from "./documents/_components/use-documents"
import { ObjectIcon } from "./crm/_components/icons"
import { useCrmSchema } from "./crm/_components/use-crm"
import { AutomationsPermissions, AUTOMATIONS_MODULE_ID } from "@digimuza/system-core/automations"
import { IngestPermissions, INGEST_MODULE_ID } from "@digimuza/system-core/ingest"
import { AI_CHAT_PERMISSION, AI_MODULE_ID } from "@/lib/ai/api"
import { NotificationsNavItem } from "@/components/notifications/notification-bell"
import { SearchNavButton } from "@/components/search/command-palette"
import { LinkPending } from "@/components/app/link-pending"

/** Live: links appear and disappear as roles, modules and flags change. */
export function AppSidebar() {
  const { t } = useT()
  const user = useCurrentUser()
  const modules = useVisibleModules()
  const financeOn = modules.some((m) => m.id === "finance" && m.effective)
  const canFinance = useCan(FinancePermissions.read)
  const aiOn = modules.some((m) => m.id === AI_MODULE_ID && m.effective)
  const canAi = useCan(AI_CHAT_PERMISSION)
  const canInvites = useCan(SystemPermissions.invitesRead)
  const canUsers = useCan(SystemPermissions.usersRead)
  const canModules = useCan(SystemPermissions.modulesRead)
  const canKeys = useCan(SystemPermissions.ownKeysRead)
  const canAudit = useCan(SystemPermissions.auditRead)
  const mcpOn = modules.some((m) => m.id === "mcp" && m.effective)
  const canMcp = useCan(McpPermissions.create) && canAi
  // CRM objects are data: the menu follows the data model live.
  const { objects: crmObjects } = useCrmSchema()
  const canCrmSchema = useCan(CrmPermissions.manageSchema)
  const automationsOn = modules.some((m) => m.id === AUTOMATIONS_MODULE_ID && m.effective)
  const canAutomations = useCan(AutomationsPermissions.read)
  const documentsOn = useDocumentsEnabled()
  const canDocuments = useCan(DocumentsPermissions.read)
  const canLabels = useCan(DocumentsPermissions.manageLabels)
  const signingOn = useSigningVisible()
  // Saved archive views marked "show in menu".
  const sidebarViews = useLabels()?.views.filter((v) => v.showInSidebar) ?? []
  const ingestOn = modules.some((m) => m.id === INGEST_MODULE_ID && m.effective)
  const canIngest = useCan(IngestPermissions.read)
  const staffingOn = useStaffingEnabled()
  const canWorkers = useCan(StaffingPermissions.workerRead)
  const canProjects = useCan(StaffingPermissions.projectRead)
  const canClients = useCan(StaffingPermissions.clientRead)
  const canCatalog = useCan(StaffingPermissions.catalogManage)

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/app">
                <BrandMark size="sm" />
                <span className="truncate font-semibold">{brand.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SearchNavButton />
          <NotificationsNavItem />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/app" exact icon={<House />} label={t("nav.home")} />
              {financeOn && canFinance && <NavItem href="/app/finance" icon={<Receipt />} label={t("nav.finance")} />}
              {aiOn && canAi && <NavItem href="/app/ai" icon={<Bot />} label={t("nav.ai")} />}
              {automationsOn && canAutomations && <NavItem href="/app/automations" icon={<Workflow />} label={t("nav.automations")} />}
              {ingestOn && canIngest && <NavItem href="/app/ingest" icon={<Mailbox />} label={t("nav.ingest")} />}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* "Darbuotojai ir projektai": the staffing base. Staffing areas append one NavItem each inside this group. */}
        {staffingOn && (canWorkers || canProjects || canClients) && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("staffing.nav.group")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {canWorkers && <NavItem href="/app/staffing/workers" icon={<HardHat />} label={t("staffing.nav.workers")} />}
                {canProjects && <NavItem href="/app/staffing/projects" icon={<FolderKanban />} label={t("staffing.nav.projects")} />}
                {canClients && <NavItem href="/app/staffing/clients" icon={<Building2 />} label={t("staffing.nav.clients")} />}
                {/* staffing areas: one NavItem each below */}
                <ComplianceNavItem Item={NavItem} />
                {canCatalog && <NavItem href="/app/staffing/catalog" icon={<Library />} label={t("staffing.nav.catalog")} />}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {documentsOn && canDocuments && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.documents")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem href="/app/documents" exact icon={<Files />} label={t("nav.documents")} />
                {sidebarViews.map((v) => (
                  <NavItem key={v.id} href={`/app/documents?view=${v.id}`} exact icon={<ListFilter />} label={v.name} />
                ))}
                {signingOn && <NavItem href="/app/documents/signing" icon={<Signature />} label={t("nav.signing")} />}
                {signingOn && <NavItem href="/app/documents/templates" icon={<FileStack />} label={t("nav.templates")} />}
                {canLabels && <NavItem href="/app/documents/labels" icon={<Tags />} label={t("nav.documentsLabels")} />}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {crmObjects && (crmObjects.length > 0 || canCrmSchema) && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.crm")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {crmObjects.map((o) => (
                  <NavItem key={o.id} href={`/app/crm/${o.key}`} icon={<ObjectIcon name={o.icon} />} label={o.namePlural} />
                ))}
                {canCrmSchema && <NavItem href="/app/crm/settings" icon={<Database />} label={t("nav.crmSettings")} />}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(canUsers || canInvites || canModules || canAudit) && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.admin")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {canUsers && <NavItem href="/app/admin/users" icon={<Users />} label={t("nav.users")} />}
                {canInvites && <NavItem href="/app/admin/invites" icon={<Mail />} label={t("nav.invites")} />}
                {canModules && <NavItem href="/app/admin/modules" icon={<AppWindow />} label={t("nav.modules")} />}
                {canAudit && <NavItem href="/app/admin/audit" icon={<ScrollText />} label={t("nav.audit")} />}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {user && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.me")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem href="/app/settings/notifications" icon={<Bell />} label={t("nav.notifications")} />
                {canKeys && <NavItem href="/app/settings/api-keys" icon={<KeyRound />} label={t("nav.apiKeys")} />}
                {mcpOn && canMcp && <NavItem href="/app/settings/mcp" icon={<Plug />} label={t("nav.mcp")} />}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>{user && <UserMenu email={user.email} name={user.displayName} isSuper={user.isSuper} />}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function NavItem({ href, exact, icon, label }: { href: string; exact?: boolean; icon: ReactNode; label: string }) {
  const path = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        {/* On phones the navigation sheet closes as the page changes underneath it. */}
        <Link href={href} aria-current={active ? "page" : undefined} onNavigate={() => isMobile && setOpenMobile(false)}>
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <LinkPending className="group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function UserMenu({ email, name, isSuper }: { email: string; name?: string | undefined; isSuper: boolean }) {
  const { t, locale } = useT()
  const router = useRouter()
  const label = name ?? email
  const initials = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("")

  async function switchLocale(l: string) {
    const fd = new FormData()
    fd.set("locale", l)
    await setLocale(fd)
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className="truncate text-xs text-muted-foreground">{isSuper ? `Super · ${email}` : email}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/app/account")}>
              <UserRound />
              {t("nav.account")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages />
                {t("lang.switch")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LOCALES.map((l) => (
                  <DropdownMenuItem key={l} onSelect={() => void switchLocale(l)}>
                    {MESSAGES[l]["lang.name"]}
                    {l === locale && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOutAction()}>
              <LogOut />
              {t("nav.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
