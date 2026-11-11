import type { ReactNode } from "react"
import { ContentFrame } from "@/components/app/content-frame"
import { CommandPalette } from "@/components/search/command-palette"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { requireSession } from "@/lib/system-server"
import { AppSidebar } from "./nav"
import { SuperToolbar } from "./super-tools"

// Every page under /app needs a signed-in system user. This is routing only:
// Convex re-checks the actor and permission on every call.
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 px-4 md:hidden">
          <SidebarTrigger />
        </header>
        <ContentFrame>{children}</ContentFrame>
      </SidebarInset>
      <SuperToolbar />
      <CommandPalette />
    </SidebarProvider>
  )
}
