// Configuration for CI and deploy scripts: process env, then Infisical.
//
// Infisical layout per environment (dev / staging / prod):
//   /     runtime secrets the app reads (WORKOS_COOKIE_PASSWORD, SITE_URL, ...)
//   /ci   CI-only secrets (CONVEX_DEPLOY_KEY, REGISTRY_*, COOLIFY_*, LINEAR_API_KEY).
//         Never visible to the running app, which reads only INFISCAL_PATH (/).
import { createSystemConfig, envSource, infisicalSource, INFISICAL_BOOTSTRAP_KEYS, type ConfigSource } from "@digimuza/system-core/config"

export const hasInfisicalBootstrap = () => INFISICAL_BOOTSTRAP_KEYS.every((k) => !!process.env[k])

export function loadConfig(options: { includeCi?: boolean } = {}) {
  const sources: ConfigSource[] = [envSource()]
  if (hasInfisicalBootstrap()) {
    sources.push(infisicalSource())
    if (options.includeCi) {
      const ciPath = process.env.INFISCAL_CI_PATH ?? "/ci"
      const src = infisicalSource({ env: { ...process.env, INFISCAL_PATH: ciPath } })
      sources.push({ name: `infisical:${ciPath}`, load: src.load })
    }
  }
  const config = createSystemConfig({ sources })
  return { config, describe: sources.map((s) => s.name).join(" + ") }
}

export function fail(script: string, message: string): never {
  console.error(`${script}: ${message}`)
  process.exit(1)
}
