import { requireSession } from "@/lib/system-server"
import { DashboardView } from "./dashboard-view"

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requireSession()
  const { denied } = await searchParams
  return (
    <DashboardView
      name={session.actor.displayName ?? null}
      isSuper={session.actor.isSuper}
      permissions={session.permissions.length}
      financeEnabled={session.modules.find((m) => m.id === "finance")?.enabled ?? false}
      denied={!!denied}
    />
  )
}
