// Where automations may insert: the app's write AI tools. Shared by
// convex/automations.ts and convex/aiConfig.ts (no "use node", no Mastra).
// Each target's zod input validates the automation's field mapping; runs act as
// the automation's owner, capped by the roles they chose.
import { documentsIngestConsumer } from "@digimuza/documents/email"
import { automationsIngestConsumer, type AutomationsOptions, type AutomationTarget } from "@digimuza/system-core/automations"
import { financeCreateInvoiceTool } from "@digimuza/system-core/finance"

export const automationTargets: AutomationTarget[] = [financeCreateInvoiceTool]

export const automationsOptions: AutomationsOptions = {
  targets: automationTargets,
  // 9Router combo `fast` (the model behind it is set in the router dashboard);
  // AUTOMATIONS_AI_MODEL or AI_MODEL on Convex override it.
  defaultModel: "fast",
}

/**
 * Gavimas (ingest) hands received mail to the email automations that read each inbox,
 * and to the documents archive, which files every email (and its attachments) by
 * default; Dokumentai → Žymos switches it off per inbox.
 */
export const ingestConsumers = [automationsIngestConsumer(automationsOptions), documentsIngestConsumer()]
