/**
 * Provisions this app's side of the shared n8n instance (n8n.digimuza.ai,
 * Community 2.1.5): the tag, the credentials and the template workflow
 * "<prefix>Laiškas → AI santrauka" (scripts/n8n/email-agent-workflow.ts), plus the
 * agent key n8n uses for the app's MCP endpoint. Idempotent: run it after every
 * change to scripts/n8n/*. The mail workflows of n8n/deploy.py are separate and
 * untouched; their "<prefix>9Router" and "<prefix>Webhook" credentials are reused
 * when their ids are known (N8N_CREDENTIAL_IDS or n8n/.credential-ids.json).
 *
 *   pnpm --filter @app/web n8n:setup [flags]      (from apps/web: pnpm n8n:setup)
 *
 * Env (Infisical `/`, loaded by the operator, e.g. `infisical run --env dev --path / -- pnpm n8n:setup`):
 *   N8N_URL, N8N_API_KEY              n8n public API (header X-N8N-API-KEY)
 *   SITE_URL                          the app; MCP endpoint ${SITE_URL}/api/v1/mcp
 *   OPENAI_BASE_URL, OPENAI_API_KEY   9Router (model combos `fast`, `smart`)
 *   N8N_WEBHOOK_SECRET                header X-Webhook-Secret the app sends to every n8n webhook
 *   N8N_AGENT_API_KEY                 agent key (dsk_…) n8n uses for the MCP endpoint
 *   optional: INFISICAL_TOKEN + INFISICAL_PROJECT_ID (+ INFISICAL_ENV, default dev)
 *             to store generated secrets; CONVEX_ENV_FILE for `npx convex run`
 *             (default: the deployment of apps/web/.env.local); N8N_MODEL (default fast);
 *             N8N_CREDENTIAL_IDS (JSON of n8n/deploy.py); N8N_LINK_INBOX (address to link).
 *
 * Flags:
 *   --dry-run                  print the plan, change nothing
 *   --generate-webhook-secret  if N8N_WEBHOOK_SECRET is missing, generate it and store it in Infisical
 *   --issue-key                if N8N_AGENT_API_KEY is missing, issue one (`n8nSetup:_issueAgentKey`) and store it in Infisical
 *   --recreate-credentials     delete and recreate our credentials even if unchanged (reused deploy.py ones are kept)
 *   --activate                 activate the workflow (a new one is created inactive)
 *   --link-inbox=<address>     link that Gavimas inbox to the workflow via `n8n:_linkInbox` (or N8N_LINK_INBOX)
 *
 * Agent key: without N8N_AGENT_API_KEY and --issue-key, an existing "<prefix>API"
 * credential is kept as is; the placeholder "pending" is used only when none exists yet.
 * With --issue-key the new key is created first, its secret stored (Infisical, if configured)
 * and the n8n credential/workflow updated; only then are the older "n8n" keys of the same
 * owner revoked (`n8nSetup:_revokeOtherAgentKeys`). If anything fails before that, the old
 * key keeps working and the new key id is printed (revoke it, or rerun).
 *
 * Orphan credentials: if a run dies after creating a credential and before saving the
 * workflow, the new credential is referenced by nothing and the API cannot list it:
 * delete it by hand in the n8n UI (Credentials, name "<prefix>…", the unused one).
 *
 * Isolation on the shared instance: everything we own carries the TAG
 * tag and a PREFIX name; nothing else is read or changed.
 *
 * n8n 2.1.5 public API quirks handled here: credentials can be created and
 * deleted but not listed, read or updated (GET/PATCH → 405). Credential IDs are
 * therefore read back from our workflow's nodes, and an HMAC fingerprint of each
 * credential's data is kept in the workflow's staticData (`appSetup`), so a
 * changed secret is detected and the credential is recreated and re-pointed.
 * Secret values are never printed.
 */
import { spawnSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildEmailAgentWorkflow, emailAgentWebhookPath, emailAgentWorkflowName, type CredentialRef } from "./n8n/email-agent-workflow.ts"

const SCRIPT = "n8n-setup"
/** Copy of N8N_TAG / N8N_NAME_PREFIX in modules/n8n.ts (plain script: no app imports). Keep in sync. */
const TAG = "dr-nuoma"
const PREFIX = `${TAG} – `
const WORKFLOW_NAME = emailAgentWorkflowName(PREFIX)
const WEBHOOK_PATH = emailAgentWebhookPath(TAG)
/** n8n/deploy.py keeps the ids of the credentials it created here. */
const DEPLOY_STATE = join(dirname(fileURLToPath(import.meta.url)), "../../../n8n/.credential-ids.json")
const PENDING = "pending"
const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")

type Action = "created" | "updated" | "unchanged" | "recreated" | "skipped" | "would create" | "would update" | "would recreate" | "pending" | "linked" | "deleted" | "failed"
const summary: { kind: string; name: string; id: string; action: Action; note?: string }[] = []
const hints: string[] = []
const record = (kind: string, name: string, id: string, action: Action, note?: string) => summary.push({ kind, name, id, action, ...(note ? { note } : {}) })

/** Masks anything that looks like a secret we handle. */
const SECRET_VALUES = new Set<string>()
function redact(s: string): string {
  let out = s
  for (const v of SECRET_VALUES) if (v && v.length >= 6) out = out.split(v).join("<REDACTED>")
  return out.replace(/dsk_[a-z0-9]{8,16}_[A-Za-z0-9_-]{20,}/g, "<REDACTED>")
}
/** Set while a freshly issued agent key exists but older keys are not revoked yet. */
let issuedKeyId: string | null = null
function fail(message: string): never {
  console.error(`${SCRIPT}: ${redact(message)}`)
  if (issuedKeyId)
    console.error(`${SCRIPT}: the new agent key ${issuedKeyId} exists; older "n8n" keys were NOT revoked and keep working. Revoke ${issuedKeyId} or rerun.`)
  process.exit(1)
}

function env(name: string, opts: { secret?: boolean; optional?: boolean } = {}): string {
  const value = process.env[name]?.trim() ?? ""
  if (!value && !opts.optional) fail(`${name} is not set (load Infisical \`/\` into the environment: infisical run --env dev --path / -- …)`)
  if (opts.secret && value) SECRET_VALUES.add(value)
  return value
}

const N8N_URL = env("N8N_URL").replace(/\/+$/, "")
const N8N_API_KEY = env("N8N_API_KEY", { secret: true })
const SITE_URL = env("SITE_URL").replace(/\/+$/, "")
const OPENAI_BASE_URL = env("OPENAI_BASE_URL")
const OPENAI_API_KEY = env("OPENAI_API_KEY", { secret: true })
const MODEL = env("N8N_MODEL", { optional: true }) || "fast"
const CONVEX_ENV_FILE = env("CONVEX_ENV_FILE", { optional: true })
const INFISICAL_ENV = env("INFISICAL_ENV", { optional: true }) || "dev"
const LINK_INBOX = [...args].find((a) => a.startsWith("--link-inbox="))?.slice("--link-inbox=".length) || env("N8N_LINK_INBOX", { optional: true })

/** Credential ids n8n/deploy.py created ({ ai, webhook, … }); empty when unknown. */
function deployCredentialIds(): Record<string, string> {
  try {
    const fromEnv = JSON.parse(process.env.N8N_CREDENTIAL_IDS || "{}") as Record<string, string>
    const fromFile = existsSync(DEPLOY_STATE) ? (JSON.parse(readFileSync(DEPLOY_STATE, "utf8")) as Record<string, string>) : {}
    return { ...fromEnv, ...fromFile }
  } catch {
    hints.push("N8N_CREDENTIAL_IDS or n8n/.credential-ids.json is not valid JSON: deploy.py credentials not reused.")
    return {}
  }
}
const canStoreSecrets = !!process.env.INFISICAL_TOKEN && !!process.env.INFISICAL_PROJECT_ID

/* ---------- Infisical / Convex helpers ---------- */

/** false: Infisical is not configured; a string: the (redacted) error. */
function storeSecret(name: string, value: string): true | false | string {
  if (!canStoreSecrets) return false
  const dir = mkdtempSync(join(tmpdir(), "n8n-setup-"))
  const file = join(dir, "value")
  try {
    writeFileSync(file, value, { mode: 0o600 })
    // The token goes through the environment, never argv (visible in `ps`).
    const res = spawnSync(
      "infisical",
      ["secrets", "set", `--projectId=${process.env.INFISICAL_PROJECT_ID}`, `--env=${INFISICAL_ENV}`, "--path=/", `${name}=@${file}`, "--silent"],
      { encoding: "utf8", env: { ...process.env, INFISICAL_TOKEN: process.env.INFISICAL_TOKEN } },
    )
    if (res.error || res.status !== 0) return `infisical secrets set ${name} failed: ${redact(res.error?.message || res.stderr || res.stdout || "")}`
    return true
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function convexRun(fn: string, input: unknown): { ok: true; out: string } | { ok: false; missing: boolean; error: string } {
  const res = spawnSync("npx", ["convex", "run", fn, JSON.stringify(input), ...(CONVEX_ENV_FILE ? ["--env-file", CONVEX_ENV_FILE] : [])], { encoding: "utf8" })
  if (res.status === 0) return { ok: true, out: res.stdout }
  const error = redact(`${res.stderr ?? ""}${res.stdout ?? ""}`.trim())
  return { ok: false, missing: /could not find (public |internal )?function|function .* (was not found|does not exist)|not found/i.test(error), error }
}

/* ---------- Secrets the workflow needs ---------- */

function webhookSecret(): string {
  const existing = env("N8N_WEBHOOK_SECRET", { secret: true, optional: true })
  if (existing) return existing
  if (!args.has("--generate-webhook-secret"))
    fail(
      "N8N_WEBHOOK_SECRET is not set. Generate and store it (the value is never printed):\n" +
        "  printf %s \"$(openssl rand -hex 32)\" > /tmp/whs && infisical secrets set --projectId=<project> --env=dev --path=/ N8N_WEBHOOK_SECRET=@/tmp/whs --silent && rm /tmp/whs\n" +
        "or rerun with --generate-webhook-secret and INFISICAL_TOKEN + INFISICAL_PROJECT_ID set. The app (ingest → n8n) must use the same value.",
    )
  if (!canStoreSecrets) fail("--generate-webhook-secret needs INFISICAL_TOKEN and INFISICAL_PROJECT_ID to store the secret")
  const value = randomBytes(32).toString("hex")
  SECRET_VALUES.add(value)
  if (dryRun) {
    record("secret", "N8N_WEBHOOK_SECRET", "-", "would create")
    return value
  }
  const stored = storeSecret("N8N_WEBHOOK_SECRET", value)
  if (stored !== true) fail(stored || "Infisical is not configured")
  record("secret", "N8N_WEBHOOK_SECRET", `infisical:${INFISICAL_ENV}:/`, "created")
  return value
}

/**
 * The agent key for the "<prefix>API" credential: the env value, a freshly issued
 * key (--issue-key), or `null` = keep the existing credential (placeholder if none).
 */
function agentKey(): { secret: string; issued?: string } | null {
  const existing = env("N8N_AGENT_API_KEY", { secret: true, optional: true })
  if (existing) return { secret: existing }
  if (!args.has("--issue-key")) return null
  if (dryRun) {
    record("secret", "N8N_AGENT_API_KEY", "-", "would create")
    return { secret: PENDING }
  }
  const res = convexRun("n8nSetup:_issueAgentKey", { name: "n8n" })
  if (!res.ok) {
    if (!res.missing) fail(`n8nSetup:_issueAgentKey failed: ${res.error}`)
    hints.push("n8nSetup:_issueAgentKey is not deployed yet: deploy Convex, then rerun with --issue-key.")
    record("secret", "N8N_AGENT_API_KEY", "-", "skipped", "function not deployed")
    return null
  }
  const issued = JSON.parse(res.out.slice(res.out.indexOf("{"))) as { apiKeyId: string; secret: string }
  SECRET_VALUES.add(issued.secret)
  issuedKeyId = issued.apiKeyId
  const stored = storeSecret("N8N_AGENT_API_KEY", issued.secret)
  if (typeof stored === "string") fail(`${stored}\nThe new key was not stored; nothing else was changed.`)
  if (!stored) hints.push("The new agent key was NOT stored in Infisical (INFISICAL_TOKEN / INFISICAL_PROJECT_ID missing); it lives only in the n8n credential. Rerun with --issue-key once they are set.")
  record("api key", "n8n", issued.apiKeyId, "created", stored ? "stored in Infisical" : "not stored")
  return { secret: issued.secret, issued: issued.apiKeyId }
}

/* ---------- n8n public API ---------- */

async function n8n<T = unknown>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": N8N_API_KEY, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok && !okStatuses.includes(res.status)) fail(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T }
}

interface Tag {
  id: string
  name: string
}
interface Node {
  id?: string
  name: string
  type: string
  typeVersion: number
  position: number[]
  parameters: Record<string, unknown>
  credentials?: Record<string, CredentialRef>
  webhookId?: string
}
interface Workflow {
  id: string
  name: string
  active: boolean
  nodes: Node[]
  connections: Record<string, unknown>
  settings: Record<string, unknown>
  staticData?: { appSetup?: SetupState } | null
  tags?: Tag[]
}
interface SetupState {
  v: 1
  /** Credential name → HMAC fingerprint of its type + data. */
  credentials: Record<string, string>
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  do {
    const sep = path.includes("?") ? "&" : "?"
    const query: string = `${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    const page: { data: T[]; nextCursor: string | null } = (await n8n<{ data: T[]; nextCursor: string | null }>("GET", `${path}${query}`)).data
    out.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return out
}

async function ensureTag(): Promise<Tag> {
  const found = (await listAll<Tag>("/tags")).find((t) => t.name === TAG)
  if (found) {
    record("tag", TAG, found.id, "unchanged")
    return found
  }
  if (dryRun) {
    record("tag", TAG, "-", "would create")
    return { id: "<new>", name: TAG }
  }
  const { data } = await n8n<Tag>("POST", "/tags", { name: TAG })
  record("tag", TAG, data.id, "created")
  return data
}

/** Our workflow: exact name among workflows tagged TAG. */
async function findWorkflow(): Promise<Workflow | null> {
  const tagged = (await listAll<Workflow>(`/workflows?tags=${encodeURIComponent(TAG)}`)).filter((w) => w.name === WORKFLOW_NAME)
  if (tagged.length > 1) hints.push(`Duplicate workflows named "${WORKFLOW_NAME}" tagged ${TAG}: ${tagged.map((w) => w.id).join(", ")}. Updating the oldest; delete the others.`)
  const first = tagged.sort((a, b) => String((a as unknown as { createdAt: string }).createdAt).localeCompare(String((b as unknown as { createdAt: string }).createdAt)))[0]
  if (!first) return null
  return (await n8n<Workflow>("GET", `/workflows/${first.id}`)).data
}

/* ---------- Credentials ---------- */

interface CredentialSpec {
  key: "openAi" | "api" | "webhook"
  name: string
  type: string
  data: Record<string, unknown>
}

const fingerprint = (key: string, spec: CredentialSpec) =>
  createHmac("sha256", key)
    .update(JSON.stringify([spec.name, spec.type, Object.entries(spec.data).sort(([a], [b]) => a.localeCompare(b))]))
    .digest("hex")
    .slice(0, 32)

/** Credential ref currently used by the workflow for `credType` (e.g. httpHeaderAuth). */
function currentRef(wf: Workflow | null, credType: string, name: string): CredentialRef | null {
  for (const node of wf?.nodes ?? []) {
    const ref = node.credentials?.[credType]
    if (ref?.id && ref.name === name) return ref
  }
  return null
}

async function ensureCredential(spec: CredentialSpec, wf: Workflow | null, fpKey: string, state: SetupState): Promise<CredentialRef> {
  const fp = fingerprint(fpKey, spec)
  const existing = currentRef(wf, spec.type, spec.name)
  const same = existing && state.credentials[spec.name] === fp && !args.has("--recreate-credentials")
  if (existing && same) {
    record("credential", spec.name, existing.id, "unchanged")
    return existing
  }
  if (dryRun) {
    record("credential", spec.name, existing?.id ?? "-", existing ? "would recreate" : "would create")
    state.credentials[spec.name] = fp
    return existing ?? { id: "<new>", name: spec.name }
  }
  const { data } = await n8n<{ id: string; name: string }>("POST", "/credentials", { name: spec.name, type: spec.type, data: spec.data })
  state.credentials[spec.name] = fp
  if (existing) {
    // The workflow is re-pointed below; the old one goes once nothing uses it.
    pendingDeletes.push(existing)
    record("credential", spec.name, data.id, "recreated", `replaces ${existing.id}`)
  } else record("credential", spec.name, data.id, "created")
  return { id: data.id, name: data.name }
}
const pendingDeletes: CredentialRef[] = []

/* ---------- Workflow ---------- */

const pick = (s: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))
const NODE_KEYS = ["id", "name", "type", "typeVersion", "position", "parameters", "credentials", "webhookId"]
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
function sameWorkflow(cur: Workflow, next: ReturnType<typeof buildEmailAgentWorkflow> & { staticData: unknown }): boolean {
  const norm = (w: { nodes: unknown[]; connections: unknown; settings: Record<string, unknown>; staticData?: unknown }) =>
    JSON.stringify(
      canonical({
        nodes: (w.nodes as Record<string, unknown>[]).map((n) => pick(n, NODE_KEYS)),
        connections: w.connections,
        settings: pick(w.settings ?? {}, Object.keys(next.settings)),
        staticData: (w.staticData as { appSetup?: unknown } | null)?.appSetup ?? null,
      }),
    )
  return norm(cur) === norm(next as never)
}

async function main() {
  console.log(`${SCRIPT}: ${N8N_URL} (app ${SITE_URL})${dryRun ? " [dry run]" : ""}`)
  const secret = webhookSecret()
  const key = agentKey()

  const tag = await ensureTag()
  const wf = await findWorkflow()
  const state: SetupState = { v: 1, credentials: { ...(wf?.staticData?.appSetup?.credentials ?? {}) } }
  // Fingerprints are keyed by the webhook secret: not reversible without it.
  const fpKey = `${TAG}-n8n-setup:${secret}`
  const API_CREDENTIAL = `${PREFIX}API`
  // No new key: keep the existing API credential untouched; placeholder only when there is none.
  const keptApi = key ? null : currentRef(wf, "httpBearerAuth", API_CREDENTIAL)
  if (!key && !keptApi) {
    hints.push(
      `N8N_AGENT_API_KEY is not set: credential "${API_CREDENTIAL}" holds the placeholder "pending", so MCP calls fail. ` +
        "Rerun with --issue-key (stores the key in Infisical) or set N8N_AGENT_API_KEY.",
    )
    record("secret", "N8N_AGENT_API_KEY", "-", "pending", "placeholder credential")
  }
  // Same names, types and data as n8n/deploy.py's credentials ("ai", "webhook"): reused by id when known.
  const deployIds = deployCredentialIds()
  const specs: (CredentialSpec & { deployKey?: string })[] = [
    { key: "openAi", deployKey: "ai", name: `${PREFIX}9Router`, type: "openAiApi", data: { apiKey: OPENAI_API_KEY, url: OPENAI_BASE_URL, header: false } },
    { key: "api", name: API_CREDENTIAL, type: "httpBearerAuth", data: { token: key?.secret ?? PENDING } },
    { key: "webhook", deployKey: "webhook", name: `${PREFIX}Webhook`, type: "httpHeaderAuth", data: { name: "X-Webhook-Secret", value: secret } },
  ]
  const refs = {} as Record<CredentialSpec["key"], CredentialRef>
  for (const spec of specs) {
    const deployId = spec.deployKey ? deployIds[spec.deployKey] : undefined
    if (deployId) {
      record("credential", spec.name, deployId, "unchanged", "reused (n8n/deploy.py)")
      refs[spec.key] = { id: deployId, name: spec.name }
    } else if (spec.key === "api" && keptApi) {
      record("credential", spec.name, keptApi.id, "unchanged", "kept (no new key)")
      refs.api = keptApi
    } else refs[spec.key] = await ensureCredential(spec, wf, fpKey, state)
  }

  const desired = { ...buildEmailAgentWorkflow({ tag: TAG, namePrefix: PREFIX, siteUrl: SITE_URL, credentialIds: refs, model: MODEL }), staticData: { appSetup: state } }
  let workflowId = wf?.id ?? "<new>"
  let active = wf?.active ?? false
  if (!wf) {
    if (dryRun) record("workflow", WORKFLOW_NAME, "-", "would create")
    else {
      const { data } = await n8n<Workflow>("POST", "/workflows", desired)
      workflowId = data.id
      active = data.active
      record("workflow", WORKFLOW_NAME, data.id, "created")
    }
  } else if (sameWorkflow(wf, desired)) record("workflow", WORKFLOW_NAME, wf.id, "unchanged")
  else if (dryRun) record("workflow", WORKFLOW_NAME, wf.id, "would update")
  else {
    await n8n("PUT", `/workflows/${wf.id}`, desired)
    record("workflow", WORKFLOW_NAME, wf.id, "updated")
  }

  if (!dryRun) {
    const { data: tags } = await n8n<Tag[]>("GET", `/workflows/${workflowId}/tags`)
    if (!tags.some((t) => t.id === tag.id)) {
      await n8n("PUT", `/workflows/${workflowId}/tags`, [...tags.map((t) => ({ id: t.id })), { id: tag.id }])
      record("workflow tag", TAG, workflowId, "updated")
    }
    if (!active && args.has("--activate")) {
      await n8n("POST", `/workflows/${workflowId}/activate`, {})
      record("activation", WORKFLOW_NAME, workflowId, "updated", "activated")
    } else record("activation", WORKFLOW_NAME, workflowId, "unchanged", active ? "active" : "inactive (--activate to turn on)")
    for (const old of pendingDeletes) {
      const { status } = await n8n("DELETE", `/credentials/${old.id}`, undefined, [404])
      record("credential", old.name, old.id, status === 404 ? "skipped" : "deleted", status === 404 ? "old one already gone" : "replaced, no longer used")
    }
    if (key?.issued) {
      // The new secret is stored and in use: only now retire the older keys.
      const res = convexRun("n8nSetup:_revokeOtherAgentKeys", { name: "n8n", keepApiKeyId: key.issued })
      issuedKeyId = null
      if (!res.ok)
        fail(
          `n8nSetup:_revokeOtherAgentKeys failed: ${res.error}\nThe new key ${key.issued} is stored and in use; older "n8n" keys are still active. ` +
            `Revoke them: npx convex run n8nSetup:_revokeOtherAgentKeys '${JSON.stringify({ name: "n8n", keepApiKeyId: key.issued })}' --env-file <convex env>`,
        )
      const { revoked } = JSON.parse(res.out.slice(res.out.indexOf("{"))) as { revoked: string[] }
      record("api key", "n8n (older)", revoked.join(", ") || "-", revoked.length ? "deleted" : "unchanged", revoked.length ? "revoked" : "none to revoke")
    }
  }

  if (LINK_INBOX) {
    const address = LINK_INBOX
    if (dryRun || workflowId === "<new>") record("inbox link", address, workflowId, "skipped", "dry run")
    else {
      const res = convexRun("n8n:_linkInbox", { address, workflowId })
      if (res.ok) record("inbox link", address, workflowId, "linked")
      else if (res.missing) {
        record("inbox link", address, workflowId, "skipped", "n8n:_linkInbox not deployed")
        hints.push(`n8n:_linkInbox is not deployed yet. After the Convex deploy: npx convex run n8n:_linkInbox '${JSON.stringify({ address, workflowId })}' --env-file <convex env>`)
      } else fail(`n8n:_linkInbox failed: ${res.error}`)
    }
  } else record("inbox link", "-", workflowId, "skipped", "no --link-inbox")

  const rows = summary.map((r) => [r.kind, r.name, r.id, r.action, r.note ?? ""])
  const head = ["KIND", "NAME", "ID", "RESULT", "NOTE"]
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()
  console.log("\n" + line(head))
  for (const r of rows) console.log(line(r))
  console.log(`\nWebhook: ${N8N_URL}/webhook/${WEBHOOK_PATH} (POST, header X-Webhook-Secret)`)
  console.log(`MCP endpoint used by the agent: ${SITE_URL}/api/v1/mcp`)
  for (const h of hints) console.log(`hint: ${redact(h)}`)
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)))
