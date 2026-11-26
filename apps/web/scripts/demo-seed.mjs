// Fill a dev Convex deployment with the full demo: catalog, CRM blueprint, then every
// area's demo data in dependency order. Idempotent: each seed skips what already exists.
// `pnpm demo:seed` (needs `pnpm dev` or `npx convex dev` running). `--reset` re-seeds the areas.
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const reset = process.argv.includes("--reset")

const steps = [
  ["system:registerSystem"],
  ["crm:_applyBlueprint"],
  ["staffing:_seedDemo", true],
  ["teams:_seedDemo", true],
  ["timesheets:_seedDemo", true],
  ["planning:_seedDemo", true],
  ["logistics:_seedDemo", true],
  ["compliance:_seedDemo", true],
  ["invoicing:_seedDemo", true],
  ["crmDemo:seed"],
]

for (const [fn, resettable] of steps) {
  const args = ["convex", "run", fn, ...(reset && resettable ? ['{"reset":true}'] : [])]
  process.stdout.write(`→ ${fn}${reset && resettable ? " (reset)" : ""}\n`)
  const r = spawnSync("npx", args, { cwd, stdio: "inherit" })
  if (r.status !== 0) {
    console.error(`✗ ${fn} failed`)
    process.exit(r.status ?? 1)
  }
}
console.log("✓ Demo data ready. Open http://localhost:3000")
