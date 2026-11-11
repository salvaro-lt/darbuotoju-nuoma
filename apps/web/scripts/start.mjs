// Container entrypoint (see Dockerfile). Loads configuration once — process
// env plus Infisical when the INFISCAL_* bootstrap keys are set — into
// process.env, then starts Next's standalone server. This is what lets one
// image run on staging and production: nothing environment-specific is baked in.
//
// Errors name keys only. If loading fails the server still starts, and
// /api/health reports 503 until the configuration is fixed.
import { createSystemConfig, envSource, infisicalSource, INFISICAL_BOOTSTRAP_KEYS } from "@digimuza/system-core/config"
import { z } from "zod"

const hasBootstrap = INFISICAL_BOOTSTRAP_KEYS.every((k) => !!process.env[k])
if (hasBootstrap) {
  const config = createSystemConfig({ sources: [envSource(), infisicalSource()] })
  try {
    await config.load()
    const all = config.register(z.looseObject({}), { moduleId: "start" })
    for (const [k, v] of Object.entries(all)) if (typeof v === "string") process.env[k] = v
    process.env.SYSTEM_CONFIG_PRELOADED = "1"
    console.log(`[start] loaded ${Object.keys(all).length} keys (env + infisical ${process.env.INFISCAL_ENV})`)
  } catch (e) {
    console.error(`[start] configuration failed: ${e instanceof Error ? e.message : "unknown error"}`)
  }
} else {
  console.warn("[start] no Infisical bootstrap; using process env only")
}

await import("./server.js")
