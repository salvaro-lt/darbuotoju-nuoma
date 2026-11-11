// Every business module this app ships. Reusable modules come from
// @digimuza/system-core (one fix reaches every client app) or a workspace package
// (packages/*); write an app-only
// module with defineModule only if it will never be reused.
// `pnpm deploy:convex` runs `system:registerSystem` so the catalog matches this list.
import { crm, CrmPermissions } from "@digimuza/crm"
import { documents, DocumentsPermissions } from "@digimuza/documents/manifest"
import { ai, AiPermissions } from "@digimuza/system-core/ai"
import { automations, AutomationsPermissions } from "@digimuza/system-core/automations"
import { finance, FinancePermissions } from "@digimuza/system-core/finance"
import { ingest, IngestPermissions } from "@digimuza/system-core/ingest"
import { n8n, N8nPermissions, N8nSubroles, type N8nPermission } from "./n8n"
import { staffing, StaffingPermissions } from "@digimuza/staffing/manifest"
import { staffingTeams } from "@digimuza/staffing/teams/manifest"
import { staffingTimesheets } from "@digimuza/staffing/timesheets/manifest"
import { staffingCompliance } from "@digimuza/staffing/compliance/manifest"
import { staffingInvoicing } from "@digimuza/staffing/invoicing/manifest"
import { mcp, McpPermissions } from "@digimuza/system-core/mcp"
import { staffingLogistics } from "@digimuza/staffing/logistics/manifest"

// `mcp` (ChatGPT / Claude over MCP) needs `ai`. `automations`: email / form → AI → insert.
// `ingest` ("Gavimas"): Resend integration and inboxes; email automations read its inboxes.
// `documents`: archive with labels (Paperless-ngx style) and e-signing (DocuSeal style).
// `staffing`: workers, clients, projects, assignments (packages/staffing). Staffing areas add their manifest after it.
export const appModules = [
  ai,
  finance,
  mcp,
  crm,
  automations,
  ingest,
  documents,
  // `n8n` (modules/n8n.ts): email → n8n webhook workflows, assistant tools for n8n workflows.
  n8n,
  staffing,
  // staffing areas: one line each below (teams, timesheets, invoicing, logistics, compliance)
  staffingTeams,
  staffingLogistics,
  staffingTimesheets,
  staffingCompliance,
  staffingInvoicing,
]
export { n8n, N8nPermissions, N8nSubroles, type N8nPermission }
export { staffing, StaffingPermissions, ai, AiPermissions, automations, AutomationsPermissions, crm, CrmPermissions, documents, DocumentsPermissions, finance, FinancePermissions, ingest, IngestPermissions, mcp, McpPermissions }
