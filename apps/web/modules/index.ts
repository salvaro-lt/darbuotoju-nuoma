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
import { mcp, McpPermissions } from "@digimuza/system-core/mcp"

// `mcp` (ChatGPT / Claude over MCP) needs `ai`. `automations`: email / form → AI → insert.
// `ingest` ("Gavimas"): Resend integration and inboxes; email automations read its inboxes.
// `documents`: archive with labels (Paperless-ngx style) and e-signing (DocuSeal style).
export const appModules = [ai, finance, mcp, crm, automations, ingest, documents]
export { ai, AiPermissions, automations, AutomationsPermissions, crm, CrmPermissions, documents, DocumentsPermissions, finance, FinancePermissions, ingest, IngestPermissions, mcp, McpPermissions }
