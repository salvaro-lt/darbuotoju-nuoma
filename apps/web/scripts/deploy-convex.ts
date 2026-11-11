/**
 * Deploys the Convex side of one environment. Run by the release workflows
 * (`pnpm deploy:convex` with INFISCAL_ENV=staging|prod), or by hand.
 *
 *  1. Loads configuration: process env, plus Infisical `/` and `/ci` when the
 *     INFISCAL_* bootstrap keys are set.
 *  2. Validates the public, Convex and deploy keys. Errors name keys, never values.
 *  3. Copies the Convex env keys (env.ts → convexEnvSchema) to the deployment.
 *  4. `convex deploy` (schema + functions), then `convex run system:registerSystem`.
 *     Registration is idempotent and aborts atomically on catalog conflicts,
 *     so a failed deploy never activates a partial catalog.
 *  5. Module install hooks: `convex run crm:_applyBlueprint` adds the CRM
 *     objects and fields from convex/crm.ts that are missing. Additive only.
 *
 * Flag: --check validates and prints the plan without changing anything.
 */
import { spawnSync } from "node:child_process"
import { z } from "zod"
import { CONVEX_ENV_KEYS, convexEnvSchema, parse, publicEnvSchema } from "../env.ts"
import { fail as failWith, loadConfig } from "./lib/config.ts"

const fail = (m: string): never => failWith("deploy-convex", m)
const check = process.argv.includes("--check") || process.argv.includes("--skip-deploy")
const { config, describe } = loadConfig({ includeCi: true })

const deploySchema = z
  .object({
    CONVEX_DEPLOY_KEY: z.string().min(1).optional(),
    CONVEX_SELF_HOSTED_URL: z.url().optional(),
    CONVEX_SELF_HOSTED_ADMIN_KEY: z.string().min(1).optional(),
  })
  .refine((d) => !!d.CONVEX_DEPLOY_KEY || (!!d.CONVEX_SELF_HOSTED_URL && !!d.CONVEX_SELF_HOSTED_ADMIN_KEY), {
    message: "Set CONVEX_DEPLOY_KEY, or CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY",
    path: ["CONVEX_DEPLOY_KEY"],
  })
// Raw strings, exactly as stored, to copy to Convex.
const rawConvexSchema = z.object(Object.fromEntries(CONVEX_ENV_KEYS.map((k) => [k, z.string().optional()])))

function convex(cliArgs: string[], env: Record<string, string | undefined>, input?: string) {
  console.log(`deploy-convex: convex ${cliArgs.join(" ")}`)
  const res = spawnSync("pnpm", ["exec", "convex", ...cliArgs], {
    env: env as NodeJS.ProcessEnv,
    input,
    stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
  })
  if (res.status !== 0) fail(`convex ${cliArgs[0]} failed (exit ${res.status ?? "signal"})`)
}

const dotenvLine = (k: string, v: string) => `${k}=${JSON.stringify(v)}`

async function main() {
  console.log(`deploy-convex: config sources: ${describe}`)
  try {
    await config.load()
  } catch (e) {
    fail(e instanceof Error ? e.message : "config load failed")
  }
  let deploy: z.infer<typeof deploySchema> = {}
  let raw: Record<string, string | undefined> = {}
  try {
    // The app's runtime keys must exist too, or the new release won't start.
    config.register(publicEnvSchema, { moduleId: "public" })
    raw = config.register(rawConvexSchema, { moduleId: "convex" })
    parse(convexEnvSchema, raw)
    if (!check) deploy = config.register(deploySchema, { moduleId: "deploy" })
  } catch (e) {
    fail(e instanceof Error ? e.message : "invalid configuration")
  }

  const convexKeys = CONVEX_ENV_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== "")
  console.log(`deploy-convex: Convex env keys: ${convexKeys.join(", ")}`)
  if (check) return console.log("deploy-convex: --check, no changes made")

  // Only what the Convex CLI needs; never the whole loaded config.
  const cliEnv: Record<string, string | undefined> = { NODE_ENV: "production", PATH: process.env.PATH, HOME: process.env.HOME, CI: "1" }
  for (const [k, v] of Object.entries(deploy)) if (v) cliEnv[k] = v

  convex(["env", "set", "--force"], cliEnv, `${convexKeys.map((k) => dotenvLine(k, raw[k]!)).join("\n")}\n`)
  convex(["deploy", "--typecheck", "disable"], cliEnv)
  convex(["run", "system:registerSystem"], cliEnv)
  convex(["run", "crm:_applyBlueprint"], cliEnv)
  console.log("deploy-convex: done")
}

await main()
