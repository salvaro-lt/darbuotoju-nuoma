/**
 * Exports CI secrets from Infisical (`/` and `/ci` of INFISCAL_ENV) to later
 * steps of a GitHub Actions job. Values are masked in the log first.
 *
 *   node scripts/ci-secrets.ts REGISTRY_USERNAME REGISTRY_PASSWORD LINEAR_API_KEY?
 *
 * A trailing `?` marks a key optional. Missing required keys fail the step,
 * naming the keys only.
 */
import { appendFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { fail as failWith, loadConfig } from "./lib/config.ts"

const fail = (m: string): never => failWith("ci-secrets", m)
const specs = process.argv.slice(2).map((a) => ({ key: a.replace(/\?$/, ""), optional: a.endsWith("?") }))
if (!specs.length) fail("no keys requested")
const out = process.env.GITHUB_ENV
if (!out) fail("GITHUB_ENV is not set (run inside GitHub Actions)")

const { config, describe } = loadConfig({ includeCi: true })
try {
  await config.load()
} catch (e) {
  fail(e instanceof Error ? e.message : "config load failed")
}
const schema = z.object(Object.fromEntries(specs.map((s) => [s.key, s.optional ? z.string().optional() : z.string().min(1)])))
let values: Record<string, string | undefined> = {}
try {
  values = config.register(schema, { moduleId: "ci" })
} catch (e) {
  fail(e instanceof Error ? e.message : "missing keys")
}

const exported: string[] = []
for (const { key } of specs) {
  const value = values[key]
  if (!value) continue
  for (const line of value.split(/\r?\n/)) if (line.trim()) console.log(`::add-mask::${line}`)
  const delim = `EOF_${randomUUID()}`
  appendFileSync(out!, `${key}<<${delim}\n${value}\n${delim}\n`)
  exported.push(key)
}
console.log(`ci-secrets: exported ${exported.join(", ") || "nothing"} from ${describe}`)
