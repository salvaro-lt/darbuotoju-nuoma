import { NotificationsView } from "@/components/notifications/notifications-view"
import { requireSession } from "@/lib/system-server"

/** Own notifications and preferences: any signed-in user, Convex scopes every call to them. */
export default async function NotificationSettingsPage() {
  await requireSession()
  return <NotificationsView />
}
