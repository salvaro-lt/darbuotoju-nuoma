/**
 * Every environment variable this app reads, validated with Zod.
 *
 * Three runtimes, three schemas:
 *  - `publicEnvSchema`  URLs the browser needs. Not secret. Read at *runtime* on the server
 *                       and handed to the client (app/layout.tsx), never inlined at build
 *                       time, so one Docker image serves staging and production.
 *  - `serverEnvSchema`  Next.js server. Loaded at runtime by `SystemConfig` from the
 *                       process env plus Infisical (see `getServerEnv`).
 *  - `convexEnvSchema`  Convex deployment env (`convex env set`). `pnpm predeploy`
 *                       copies these keys from Infisical to Convex.
 *
 * `.env.example` lists the same names, with no values.
 */
import { z } from "zod"

// Required, no default: a missing APP_ENV must not silently mean "development".
const appEnv = z.enum(["development", "staging", "production"])
const emailList = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()))

// No NEXT_PUBLIC_ prefix on purpose: Next.js inlines NEXT_PUBLIC_* at build time.
export const publicEnvSchema = z.object({
  /** `https://<deployment>.convex.cloud` or the self-hosted Convex API URL. */
  CONVEX_URL: z.url(),
  /** `https://<deployment>.convex.site` or the self-hosted Convex HTTP-actions URL. */
  CONVEX_SITE_URL: z.url(),
  /** Public URL of this app, e.g. `https://acme.digimuza.ai`. Also set on Convex. */
  SITE_URL: z.url(),
})

const workosClientId = z.string().regex(/^client_[A-Za-z0-9]+$/, "a WorkOS client ID (client_…)")

export const serverEnvSchema = z.object({
  APP_ENV: appEnv,
  /** WorkOS AuthKit. One WorkOS environment per app environment (staging / production). */
  WORKOS_CLIENT_ID: workosClientId,
  /** Encrypts the session cookie. `openssl rand -base64 32`; different per environment. */
  WORKOS_COOKIE_PASSWORD: z.string().min(32),
  /** Optional. Without it AuthKit runs as a public (PKCE) client, which covers sign-in. */
  WORKOS_API_KEY: z.string().regex(/^sk_(test|live)_/).optional(),
  // Bootstrap for Infisical (provided by Coolify). Only names are validated
  // here; `SystemConfig` uses them to fetch the rest.
  INFISCAL_BASE_URL: z.url().optional(),
  INFISCAL_PROJECT_ID: z.string().min(1).optional(),
  INFISCAL_ENV: z.string().min(1).optional(),
  INFISCAL_PATH: z.string().min(1).optional(),
})

export const convexEnvSchema = z.object({
  APP_ENV: appEnv,
  /** Same value as the public SITE_URL. Used for invite links. */
  SITE_URL: z.url(),
  /** Same WorkOS client ID as the Next server: convex/auth.config.ts trusts its tokens. */
  WORKOS_CLIENT_ID: workosClientId,
  /** Comma-separated verified emails that become Super on sign-in. */
  SUPER_USER_EMAILS: emailList,
  /** Sender for invite mail, e.g. `Acme <no-reply@acme.lt>`. */
  MAIL_FROM: z.string().min(3).default("System <no-reply@digimuza.ai>"),
  /** Resend API key. Without it, mail is printed to the Convex log (development only). */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** OpenAI-compatible API for the AI assistant, e.g. 9Router `https://router.digimuza.ai/v1`. Default: api.openai.com. */
  OPENAI_BASE_URL: z.url().optional(),
  /** API key of that provider (the 9Router key). Without it the AI assistant answers "not configured". */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Model name the provider exposes (e.g. `cx/gpt-6.1-sol`); overrides `defaultModel` in convex/aiConfig.ts. */
  AI_MODEL: z.string().min(1).optional(),
  /** Automations: model for the extraction (default AI_MODEL, then convex/automationsConfig.ts). */
  AUTOMATIONS_AI_MODEL: z.string().min(1).optional(),
  /** Documents: vision model for text recognition and `auto` labels (default AI_MODEL, then convex/documents.ts). */
  DOCUMENTS_AI_MODEL: z.string().min(1).optional(),
  /**
   * Automations: the email domain of each email automation's own address, e.g. the Resend
   * receiving domain `abc123.resend.app` or `in.acme.lt` (MX → Resend). Without it email
   * automations get no address (other providers can still post to the hook URL).
   */
  AUTOMATIONS_INBOUND_DOMAIN: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "a domain like in.acme.lt").optional(),
  /** Signing secret (`whsec_…`) of the Resend webhook → /api/automations/resend (`email.received`). */
  RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  /** Full-access Resend key to read received emails (the sending key may be send-only). Default RESEND_API_KEY. */
  RESEND_RECEIVING_API_KEY: z.string().min(1).optional(),
  /**
   * Gavimas (ingest): 32 bytes, base64 (`openssl rand -base64 32`). Encrypts the Resend
   * webhook signing secret that the automatic setup stores in the database.
   */
  INGEST_ENCRYPTION_KEY: z.string().min(40).optional(),
  /** Gavimas: receiving domain when none is set up in the app (default AUTOMATIONS_INBOUND_DOMAIN). */
  INGEST_RECEIVING_DOMAIN: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "a domain like in.acme.lt").optional(),
  /** Gavimas: sender of the setup's test email (default `no-reply@<verified Resend domain>`). */
  INGEST_TEST_FROM: z.string().min(3).optional(),
  /** n8n base URL, e.g. `https://n8n.digimuza.ai`. Without it (or the key) the n8n module is not configured. */
  N8N_URL: z.url().optional(),
  /** n8n public API key (Settings → n8n API), sent as `X-N8N-API-KEY`: create, update, activate workflows. */
  N8N_API_KEY: z.string().min(1).optional(),
  /** n8n instance MCP endpoint, e.g. `https://n8n.digimuza.ai/mcp-server/http`: workflow details and runs. */
  N8N_MCP_URL: z.url().optional(),
  /** Bearer token of the n8n instance MCP server (Settings → MCP access). */
  N8N_MCP_TOKEN: z.string().min(1).optional(),
  /**
   * Shared secret for every app → n8n webhook: the `X-Webhook-Secret` header (mail workflows of
   * n8n/deploy.py, email → n8n deliveries) and the HMAC key of `X-Webhook-Signature`.
   */
  N8N_WEBHOOK_SECRET: z.string().min(1).optional(),
})

/** Keys `pnpm predeploy` copies from Infisical into the Convex deployment. */
export const CONVEX_ENV_KEYS = Object.keys(convexEnvSchema.shape) as (keyof typeof convexEnvSchema.shape)[]

export type PublicEnv = z.infer<typeof publicEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>
export type ConvexEnv = z.infer<typeof convexEnvSchema>

/**
 * Reads a variable by a computed name, so the bundler can't inline it at
 * build time. In development, falls back to the NEXT_PUBLIC_* names that
 * `npx convex dev` writes to .env.local.
 */
function runtimeEnv(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  return env[name] ?? (env.APP_ENV === "development" ? env[`NEXT_PUBLIC_${name}`] : undefined)
}

/** Public URLs, server side, at runtime. Throws, naming the missing keys. */
export function getPublicEnv(): PublicEnv {
  return parse(publicEnvSchema, Object.fromEntries(Object.keys(publicEnvSchema.shape).map((k) => [k, runtimeEnv(k)])))
}

export function parse<S extends z.ZodType>(schema: S, values: Record<string, unknown>): z.infer<S> {
  const res = schema.safeParse(values)
  if (res.success) return res.data
  const keys = [...new Set(res.error.issues.map((i) => String(i.path[0] ?? "(root)")))].sort()
  // Names only: never echo values, they may be secrets.
  throw new Error(`Invalid or missing environment variables: ${keys.join(", ")}`)
}

/** Validates the Convex deployment env. Call inside Convex functions (lazy, per invocation). */
export function getConvexEnv(): ConvexEnv {
  // Read each key by name: Convex's process.env is not a plain, enumerable object.
  return parse(convexEnvSchema, Object.fromEntries(CONVEX_ENV_KEYS.map((k) => [k, process.env[k]])))
}
