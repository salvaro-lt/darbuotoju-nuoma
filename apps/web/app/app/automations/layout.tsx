import type { ReactNode } from "react"
import { AutomationsGate } from "@/components/automations/gate"
import { AutomationsSectionNav } from "@/components/automations/section-nav"
import { AutomationsSiteUrlProvider } from "@/components/automations/shared"
import { getPublicEnv } from "@/env"

// Each page checks its permission; Convex re-checks every call.
// SITE_URL: the base of the webhook URLs and form snippets.
export default function AutomationsLayout({ children }: { children: ReactNode }) {
  return (
    <AutomationsSiteUrlProvider siteUrl={getPublicEnv().SITE_URL}>
      <AutomationsGate>
        <AutomationsSectionNav />
        {children}
      </AutomationsGate>
    </AutomationsSiteUrlProvider>
  )
}
