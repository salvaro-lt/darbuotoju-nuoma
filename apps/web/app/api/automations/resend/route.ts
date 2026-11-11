// Resend inbound (`email.received`), one endpoint for every email automation.
import { automationRoutes } from "@/lib/automation-routes"

export const dynamic = "force-dynamic"
export const { POST, GET } = automationRoutes.resend
