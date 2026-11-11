import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// The AI assistant as installed in this app (convex/ai.ts, convex/aiConfig.ts).
// The scheduled runner (convex/aiRunner.ts, Node + OpenAI) is not executed here:
// fake timers keep convex-test from firing `runAfter(0, aiRunner:runAgent)`.

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer, email: "alice@acme.test", email_verified: true }
const BOB = { subject: "user_bob", issuer, email: "bob@acme.test", email_verified: true }

let sent: { to: string[]; subject: string; text: string }[] = []
beforeEach(() => {
  sent = []
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

async function bootstrap(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  return superUser
}

async function inviteWithRole(t: T, superUser: ReturnType<T["withIdentity"]>, who: typeof ALICE, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${who.subject}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: who.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const user = t.withIdentity(who)
  await user.mutation(api.system.completeSignIn, { inviteToken: token })
  return user
}

const enable = (superUser: ReturnType<T["withIdentity"]>, moduleId: string) => superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })

describe("AI assistant", () => {
  test("the ai module is registered disabled; enabling it opens the chat to an ai:user", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const alice = await inviteWithRole(t, superUser, ALICE, ["ai:user"])
    expect(await codeOf(alice.query(api.ai.listAgents, {}))).toBe("FORBIDDEN")

    await enable(superUser, "ai")
    const agents = await alice.query(api.ai.listAgents, {})
    expect(agents.map((a) => ({ id: a.id, name: a.name }))).toEqual([
      { id: "assistant", name: "Asistentas" },
      { id: "detailed", name: "Išsamus" },
    ])
  })

  test("an ai:user creates a thread and sends a message: run queued, thread running, runner scheduled", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await enable(superUser, "ai")
    const alice = await inviteWithRole(t, superUser, ALICE, ["ai:user"])

    const { threadId } = await alice.mutation(api.ai.createThread, {})
    const { messageId, runId } = await alice.mutation(api.ai.sendMessage, { threadId, text: "Kiek yra sąskaitų?" })

    const thread = await alice.query(api.ai.getThread, { threadId })
    expect(thread).toMatchObject({ agentId: "assistant", status: "running", title: "Kiek yra sąskaitų?" })
    const messages = await alice.query(api.ai.listMessages, { threadId })
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "streaming"],
    ])
    expect(messages[0]!.id).toBe(messageId)

    const run = await t.run((ctx) => ctx.db.get(runId))
    expect(run).toMatchObject({ status: "queued", agentId: "assistant", model: "fast" })
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
    expect(scheduled.filter((s) => s.name === "aiRunner:runAgent")).toHaveLength(1)
    expect(await alice.query(api.ai.listThreads, {})).toMatchObject({ items: [{ id: threadId }] })
  })

  test("without ai:chat:use → FORBIDDEN", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await enable(superUser, "ai")
    await enable(superUser, "finance")
    const bob = await inviteWithRole(t, superUser, BOB, ["finance:reader"])
    expect(await codeOf(bob.query(api.ai.listAgents, {}))).toBe("FORBIDDEN")
    expect(await codeOf(bob.query(api.ai.listThreads, {}))).toBe("FORBIDDEN")
    expect(await codeOf(bob.mutation(api.ai.createThread, {}))).toBe("FORBIDDEN")
  })

  test("listAgents shows the finance tools only to someone holding finance permissions", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await enable(superUser, "ai")
    await enable(superUser, "finance")
    const alice = await inviteWithRole(t, superUser, ALICE, ["ai:user"])
    const bob = await inviteWithRole(t, superUser, BOB, ["ai:user", "finance:reader"])

    const toolsOf = async (as: typeof alice) => (await as.query(api.ai.listAgents, {}))[0]!.tools.map((tool) => tool.id)
    // ai.show_card needs only ai:chat:use, so every chat user has it.
    expect(await toolsOf(alice)).toEqual(["ai.show_card"])
    expect(await toolsOf(bob)).toEqual(["finance.list_invoices", "ai.show_card"])
    const all = (await superUser.query(api.ai.listAgents, {}))[0]!.tools
    expect(all.map((tool) => [tool.id, tool.requiresApproval])).toEqual([
      ["finance.list_invoices", false],
      ["finance.create_invoice", true],
      ["finance.approve_invoice", true],
      ["documents.search_documents", false],
      ["documents.list_submissions", false],
      ["staffing.list_workers", false],
      ["staffing.get_worker", false],
      ["staffing.find_available_workers", false],
      ["staffing.list_projects", false],
      ["staffing-teams.propose_team", false],
      ["staffing-compliance.project_readiness", false],
      ["automations.list", false],
      ["automations.get", false],
      ["automations.list_targets", false],
      ["automations.list_runs", false],
      ["automations.test_extract", false],
      ["automations.create", true],
      ["automations.update", true],
      ["automations.enable", true],
      ["automations.disable", true],
      ["automations.review_item", true],
      ["ingest.list_inboxes", false],
      ["ingest.create_inbox", true],
      ["ai.show_card", false],
      // withN8n (convex/aiConfig.ts): email replies and n8n workflows, after the agent's own tools.
      ["mail.reply_to_email", true],
      ["n8n.search_workflows", false],
      ["n8n.get_workflow", false],
      ["n8n.list_executions", false],
      ["n8n.list_node_types", false],
      ["n8n.get_operation", false],
      ["n8n.create_workflow", true],
      ["n8n.update_workflow", true],
      ["n8n.set_workflow_active", true],
      ["n8n.execute_workflow", true],
    ])
  })

  test("threads are owner-only: someone else's thread is NOT_FOUND", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await enable(superUser, "ai")
    const alice = await inviteWithRole(t, superUser, ALICE, ["ai:user"])
    const bob = await inviteWithRole(t, superUser, BOB, ["ai:user"])
    const { threadId } = await alice.mutation(api.ai.createThread, { title: "Alice" })

    expect(await codeOf(bob.query(api.ai.getThread, { threadId }))).toBe("NOT_FOUND")
    expect(await codeOf(bob.query(api.ai.listMessages, { threadId }))).toBe("NOT_FOUND")
    expect(await codeOf(bob.mutation(api.ai.sendMessage, { threadId, text: "hi" }))).toBe("NOT_FOUND")
    expect(await codeOf(bob.mutation(api.ai.renameThread, { threadId, title: "mine" }))).toBe("NOT_FOUND")
    expect(await codeOf(bob.mutation(api.ai.archiveThread, { threadId }))).toBe("NOT_FOUND")
    // Super included.
    expect(await codeOf(superUser.query(api.ai.getThread, { threadId }))).toBe("NOT_FOUND")
    expect((await bob.query(api.ai.listThreads, {})).items).toEqual([])
    expect(await alice.query(api.ai.getThread, { threadId })).toMatchObject({ title: "Alice" })
  })
})
