import "server-only"
import { createSystemConfig, envSource, infisicalSource, INFISICAL_BOOTSTRAP_KEYS } from "@digimuza/system-core/config"
import { getPublicEnv, serverEnvSchema, type ServerEnv } from "@/env"

const hasInfisicalBootstrap = INFISICAL_BOOTSTRAP_KEYS.every((k) => !!process.env[k])
// The container's scripts/start.mjs already merged Infisical into process.env.
const preloaded = process.env.SYSTEM_CONFIG_PRELOADED === "1"

/**
 * Process env first, then Infisical (Infisical wins). In the container,
 * scripts/start.mjs fetches Infisical once before Next starts. Locally, run
 * `infisical run --env dev -- pnpm dev` and the secrets arrive as plain env vars.
 */
export const systemConfig = createSystemConfig({
  sources: hasInfisicalBootstrap && !preloaded ? [envSource(), infisicalSource()] : [envSource()],
})

let cached: ServerEnv | null = null

/** Loads config once per process and returns the validated server env. */
export async function getServerEnv(): Promise<ServerEnv> {
  if (cached) return cached
  await systemConfig.load()
  const env = systemConfig.register(serverEnvSchema, { moduleId: "web" })
  if (env.APP_ENV !== "development" && !preloaded && !hasInfisicalBootstrap) {
    throw new Error(`APP_ENV=${env.APP_ENV} requires Infisical bootstrap: ${INFISICAL_BOOTSTRAP_KEYS.join(", ")}`)
  }
  getPublicEnv() // the public URLs are required too; throws naming missing keys
  cached = env
  return env
}
