/**
 * Moves the Linear issues referenced in a commit range to a workflow state.
 * Optional: without LINEAR_API_KEY it does nothing. It never fails a deploy;
 * problems are printed as warnings.
 *
 *   node scripts/linear-transition.ts --state "In Staging" --range origin/production..HEAD
 *   node scripts/linear-transition.ts --state Done --range HEAD^1..HEAD^2 \
 *     [--project <project id or slug>] [--version 1.2.0] [--environment production]
 *
 * Issue IDs are found in commit subjects and bodies (`DIG-123`; prefix from
 * LINEAR_ISSUE_PREFIX, default DIG). Merge commits carry the branch name, so
 * `feature/DIG-123-x` counts. Issues are never moved backwards: a Done or
 * canceled issue is left alone. With --project, a project update is posted.
 */
import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    state: { type: "string" },
    range: { type: "string" },
    project: { type: "string" },
    version: { type: "string" },
    environment: { type: "string" },
  },
})
const key = process.env.LINEAR_API_KEY
const warn = (m: string) => console.log(`::warning::linear-transition: ${m}`)
if (!key) {
  console.log("linear-transition: LINEAR_API_KEY not set, skipping")
  process.exit(0)
}
if (!args.state || !args.range) {
  warn("--state and --range are required")
  process.exit(0)
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: key!, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] }
  if (!res.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`)
  return body.data as T
}

const prefix = process.env.LINEAR_ISSUE_PREFIX ?? "DIG"
let log = ""
try {
  log = execFileSync("git", ["log", "--format=%s%n%b", args.range], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
} catch {
  warn(`git log ${args.range} failed`)
  process.exit(0)
}
const ids = [...new Set([...log.matchAll(new RegExp(`\\b${prefix}-\\d+\\b`, "g"))].map((m) => m[0]))].sort()
console.log(`linear-transition: ${ids.length} issue(s) in ${args.range}: ${ids.join(", ") || "none"}`)

type Issue = { id: string; identifier: string; state: { name: string; type: string }; team: { states: { nodes: { id: string; name: string }[] } } }
const moved: string[] = []
for (const id of ids) {
  try {
    const { issue } = await gql<{ issue: Issue | null }>(
      `query($id: String!) { issue(id: $id) { id identifier state { name type } team { states { nodes { id name } } } } }`,
      { id },
    )
    if (!issue) continue
    if (issue.state.name === args.state) continue
    if (["completed", "canceled"].includes(issue.state.type)) {
      console.log(`linear-transition: ${id} is ${issue.state.name}, leaving it`)
      continue
    }
    const target = issue.team.states.nodes.find((s) => s.name === args.state)
    if (!target) {
      warn(`team of ${id} has no state "${args.state}"`)
      continue
    }
    await gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id: issue.id, stateId: target.id })
    moved.push(id)
    console.log(`linear-transition: ${id} ${issue.state.name} -> ${args.state}`)
  } catch (e) {
    warn(`${id}: ${e instanceof Error ? e.message : "update failed"}`)
  }
}

if (args.project) {
  try {
    const { project } = await gql<{ project: { id: string } | null }>(`query($id: String!) { project(id: $id) { id } }`, { id: args.project })
    if (!project) throw new Error(`project ${args.project} not found`)
    const body = [
      `Deployed **v${args.version ?? "?"}** to **${args.environment ?? args.state}**.`,
      ids.length ? `Issues: ${ids.join(", ")}.` : "No issues referenced in this release.",
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? `Run: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n")
    await gql(`mutation($projectId: String!, $body: String!) { projectUpdateCreate(input: { projectId: $projectId, body: $body, health: onTrack }) { success } }`, {
      projectId: project.id,
      body,
    })
    console.log("linear-transition: posted project update")
  } catch (e) {
    warn(`project update: ${e instanceof Error ? e.message : "failed"}`)
  }
}
console.log(`linear-transition: moved ${moved.length}`)
