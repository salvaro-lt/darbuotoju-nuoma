/**
 * Points a Coolify "Docker Image" application at an image tag, deploys it,
 * waits for the deployment, then checks the app's /api/health reports the
 * expected revision. Used by the release workflows; never builds anything.
 *
 *   node scripts/coolify-deploy.ts --image docker.digimuza.ai/digimuza/acme --tag 1.2.0-abc1234 \
 *     --revision <git sha> [--health-url https://acme.staging.digimuza.ai/api/health]
 *
 * Env: COOLIFY_TOKEN, COOLIFY_APP_UUID, COOLIFY_URL (default https://coolify.digimuza.ai).
 */
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    image: { type: "string" },
    tag: { type: "string" },
    revision: { type: "string" },
    "health-url": { type: "string" },
    "timeout-min": { type: "string", default: "15" },
  },
})
const fail = (m: string): never => {
  console.error(`coolify-deploy: ${m}`)
  process.exit(1)
}
const base = (process.env.COOLIFY_URL ?? "https://coolify.digimuza.ai").replace(/\/+$/, "")
const token = process.env.COOLIFY_TOKEN ?? fail("COOLIFY_TOKEN is not set")
const uuid = process.env.COOLIFY_APP_UUID ?? fail("COOLIFY_APP_UUID is not set")
if (!args.image || !args.tag) fail("--image and --tag are required")
const deadline = Date.now() + Number(args["timeout-min"]) * 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // Status only: response bodies can contain env values.
  if (!res.ok) fail(`${method} ${path} failed with HTTP ${res.status}`)
  return (await res.json()) as T
}

const app = await api<{ name: string; build_pack: string }>("GET", `/applications/${uuid}`)
if (app.build_pack !== "dockerimage") fail(`${app.name} uses build pack "${app.build_pack}"; it must be "dockerimage" (Docker Image)`)
console.log(`coolify-deploy: ${app.name} -> ${args.image}:${args.tag}`)
await api("PATCH", `/applications/${uuid}`, { docker_registry_image_name: args.image, docker_registry_image_tag: args.tag })

const started = await api<{ deployments?: { deployment_uuid: string }[] }>("GET", `/deploy?uuid=${encodeURIComponent(uuid)}&force=false`)
const deploymentId = started.deployments?.[0]?.deployment_uuid ?? fail("Coolify returned no deployment")
console.log(`coolify-deploy: deployment ${deploymentId} queued`)

let status = "queued"
while (Date.now() < deadline) {
  await sleep(10_000)
  status = (await api<{ status: string }>("GET", `/deployments/${deploymentId}`)).status
  console.log(`coolify-deploy: ${status}`)
  if (["finished", "failed", "cancelled", "cancelled-by-user", "error"].includes(status)) break
}
if (status !== "finished") fail(`deployment ended with status "${status}" (see Coolify → ${app.name} → Deployments)`)

if (args["health-url"]) {
  let last = "no response"
  while (Date.now() < deadline) {
    try {
      const res = await fetch(args["health-url"], { headers: { "cache-control": "no-cache" } })
      const body = (await res.json().catch(() => ({}))) as { status?: string; revision?: string }
      last = `HTTP ${res.status} status=${body.status ?? "?"} revision=${body.revision?.slice(0, 7) ?? "?"}`
      if (res.ok && body.status === "ok" && (!args.revision || body.revision === args.revision)) {
        console.log(`coolify-deploy: healthy (${last})`)
        process.exit(0)
      }
    } catch {
      last = "unreachable"
    }
    await sleep(5_000)
  }
  fail(`health check did not pass: ${last}`)
}
console.log("coolify-deploy: done")
