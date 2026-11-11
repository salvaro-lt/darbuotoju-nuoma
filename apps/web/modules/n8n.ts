// App-only `n8n` module: the automation engine at N8N_URL. Received email flows
// into n8n webhook workflows (convex/model/n8nConsumer.ts), and the assistant
// finds, builds and runs n8n workflows (convex/n8nAiTools.ts). The n8n instance
// is shared between apps: only workflows tagged N8N_TAG are visible or changeable.
// Registers DISABLED like every business module: a Super enables it.
//
// Contract: module and permission IDs never change meaning. Add new IDs instead.
// Not humanOnly: the n8n agent key ("n8n agentas" role) may hold them too.
import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

export const N8N_MODULE_ID = "n8n"

/**
 * This app's scope on the shared n8n instance: the tag every workflow it may see
 * carries, and the name prefix of its workflows and credentials. The same prefix
 * as n8n/deploy.py (the mail workflows), so the assistant can reuse its
 * credentials by name. Plain data: scripts/n8n-setup.ts keeps a copy.
 */
export const N8N_TAG = "dr-nuoma"
export const N8N_NAME_PREFIX = `${N8N_TAG} – `

export const n8n = defineModule({
  id: N8N_MODULE_ID,
  kind: "business",
  name: "n8n",
  description: "Automatizacijos per n8n: laiškai į n8n workflow, asistentas kuria ir paleidžia workflow",
  permissions: [
    { id: "n8n:workflow:view", name: "Peržiūrėti", description: `Matyti n8n workflow (žyma ${N8N_TAG}), jų vykdymus ir laiškų perdavimus` },
    { id: "n8n:workflow:manage", name: "Valdyti", description: "Kurti, keisti, įjungti ir paleisti n8n workflow, prijungti pašto dėžutes" },
  ],
  initialSubroles: [
    { id: "n8n:viewer", name: "n8n žiūrovas", description: "Mato n8n workflow ir vykdymus", permissions: ["n8n:workflow:view"] },
    { id: "n8n:admin", name: "n8n administratorius", description: "Kuria, keičia, įjungia ir paleidžia n8n workflow", permissions: ["n8n:workflow:view", "n8n:workflow:manage"] },
  ],
  configKeys: ["N8N_URL", "N8N_API_KEY", "N8N_MCP_URL", "N8N_MCP_TOKEN", "N8N_WEBHOOK_SECRET"],
})

export type N8nPermission = PermissionOf<typeof n8n>

export const N8nPermissions = {
  view: "n8n:workflow:view",
  manage: "n8n:workflow:manage",
} as const satisfies Record<string, N8nPermission>

export const N8nSubroles = { viewer: "n8n:viewer", admin: "n8n:admin" } as const
