import { crmTables } from "@digimuza/crm"
import { documentsTables } from "@digimuza/documents"
import { staffingTables } from "@digimuza/staffing/tables"
import { aiTables } from "@digimuza/system-core/ai"
import { automationsTables } from "@digimuza/system-core/automations"
import { systemTables } from "@digimuza/system-core/convex"
import { financeTables } from "@digimuza/system-core/finance"
import { ingestTables } from "@digimuza/system-core/ingest"
import { mcpTables } from "@digimuza/system-core/mcp"
import { notificationTables } from "@digimuza/system-core/notifications"
import { defineSchema } from "convex/server"

export default defineSchema({
  // users, identities, roles, subroles, permissions, modules, apiKeys, invites,
  // featureFlags, auditEvents, roleViews, ... owned by system-core.
  ...systemTables,
  // Business modules from the library. App-only tables go below.
  ...financeTables,
  // AI assistant: aiThreads, aiMessages, aiRuns (convex/ai.ts, convex/aiRunner.ts).
  ...aiTables,
  // Notifications: in-app list + email per user preferences (convex/notifications.ts).
  ...notificationTables,
  // AI integrations (ChatGPT, Claude over MCP): one-time links, OAuth clients, connections, tokens (convex/mcp.ts).
  ...mcpTables,
  // CRM (packages/crm): objects, fields, views, records, links, notes (convex/crm.ts).
  ...crmTables,
  // Automations: definitions, versions, events, runs (convex/automations.ts).
  ...automationsTables,
  // Documents (packages/documents): archive, labels, saved views, signing templates and submissions (convex/documents.ts).
  ...documentsTables,
  // Gavimas (ingest): Resend setup, inboxes, webhook events, received emails (convex/ingest.ts).
  ...ingestTables,
  // Staffing base (packages/staffing): trades, certificate types, workers, certificates, clients, projects, assignments (convex/staffing.ts).
  ...staffingTables,
  // Staffing areas: one line each below (...timesheetsTables, ...).
})
