// Automation webhook / web form: POST with the automation's token.
import { automationRoutes } from "@/lib/automation-routes"

export const dynamic = "force-dynamic"
export const { POST, GET, OPTIONS } = automationRoutes.hook
