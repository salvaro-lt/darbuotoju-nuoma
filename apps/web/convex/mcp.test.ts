import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// AI integrations as installed in this app (convex/mcp.ts): a one-time link is
// redeemed through OAuth, then ChatGPT talks to the assistant. The threads it
// starts are the user's own AI threads, tagged with the client.

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer, email: "alice@acme.test", email_verified: true }
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"

let sent: { text: string }[] = []
beforeEach(() => {
  sent = []
  // Keeps convex-test from running the scheduled AI runner (Node + OpenAI).
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

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

async function setupAlice(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ai", "mcp", "finance"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  const { roleId: chat } = (await superUser.mutation(api.system.createRole, { name: "AI", subroleIds: ["ai:user", "finance:reader"] })) as { roleId: string }
  const { roleId: connect } = (await superUser.mutation(api.system.createRole, { name: "Connect", subroleIds: ["mcp:user"] })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [chat, connect] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return { alice, chat }
}

async function connectChatGpt(t: T, alice: ReturnType<T["withIdentity"]>, roleIds: string[]) {
  const link = await alice.action(api.mcp.createMcpLink, { roleIds, name: "Darbo ChatGPT" })
  const reg = await t.action(api.mcp.oauthRegister, { metadata: { client_name: "ChatGPT", redirect_uris: [REDIRECT] } })
  if (!reg.ok) throw new Error(reg.error)
  const clientId = String(reg.client.client_id)
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
  const auth = await t.action(api.mcp.oauthAuthorize, { linkCode: link.code, clientId, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" })
  if (!auth.ok) throw new Error(auth.error)
  const tok = await t.action(api.mcp.oauthToken, { grantType: "authorization_code", clientId, code: auth.code, codeVerifier: verifier, redirectUri: REDIRECT, linkCode: link.code })
  if (!tok.ok) throw new Error(tok.error)
  return { link, creds: { accessToken: String(tok.tokens.access_token), linkCode: link.code } }
}

describe("AI integrations (MCP)", () => {
  test("the link works once; ChatGPT's thread is tagged and listed in the user's AI chat", async () => {
    const t = setup()
    const { alice, chat } = await setupAlice(t)
    const { link, creds } = await connectChatGpt(t, alice, [chat])
    expect(await alice.query(api.mcp.getMcpLinkStatus, { linkId: link.linkId })).toMatchObject({ status: "redeemed", clientName: "ChatGPT" })

    const asked = await t.mutation(api.mcp.mcpAskAgent, { ...creds, message: "Kokias sąskaitas turiu?" })
    if (!asked.ok) throw new Error(asked.message)
    const threadId = asked.value.threadId

    const fromMcp = await alice.query(api.ai.listThreads, { source: "mcp" })
    expect(fromMcp.items).toHaveLength(1)
    expect(fromMcp.items[0]).toMatchObject({ id: threadId, source: "mcp", mcp: { clientName: "ChatGPT", connectionName: "Darbo ChatGPT" } })
    expect((await alice.query(api.ai.listThreads, { source: "app" })).items).toEqual([])
    const [conn] = await alice.query(api.mcp.listMcpConnections, {})
    expect((await alice.query(api.ai.listThreads, { mcpConnectionId: conn!.id })).items.map((x) => x.id)).toEqual([threadId])
    expect(conn).toMatchObject({ clientName: "ChatGPT", status: "active" })
    expect(conn!.lastActivityAt).not.toBeNull()

    const msgs = await alice.query(api.ai.listMessages, { threadId: threadId as never })
    expect(msgs[0]).toMatchObject({ role: "user", via: { kind: "mcp", clientName: "ChatGPT" } })
    // Read-only in the app: the client leads it, so runs there act with the connection's roles only.
    await t.mutation(internal.ai._finishRun, { runId: asked.value.runId as never, status: "done" })
    expect(await alice.mutation(api.ai.sendMessage, { threadId: threadId as never, text: "Aš pats" }).then(() => "OK", (e) => e.data?.code)).toBe("CONFLICT")

    await alice.mutation(api.mcp.revokeMcpConnection, { connectionId: conn!.id })
    expect(await t.query(api.mcp.mcpCheckToken, creds)).toEqual({ ok: false })
  })
})
