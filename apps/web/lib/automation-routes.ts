import "server-only"
import { createAutomationRoutes } from "@digimuza/system-core/automations/next"
import { getPublicEnv } from "@/env"

/**
 * Automation webhooks: /api/automations/hook/<id> (forms, JSON, other inbound-email
 * providers; token) and /api/automations/resend (Resend `email.received`; signed).
 * Convex decides everything (convex/automations.ts).
 */
export const automationRoutes = createAutomationRoutes({ convexUrl: () => getPublicEnv().CONVEX_URL })
