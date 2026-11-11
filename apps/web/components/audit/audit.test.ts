import { describe, expect, it } from "vitest"
import { MESSAGES } from "../../lib/i18n/messages"
import { DEFAULT_RANGE, filterToSearch, isFiltered, localDayStart, matchesClient, parseFilter, toQueryArgs } from "./filters"
import { actionLabel, actionTypeLabel, moduleLabel, threadIdOf, type Lookup } from "./labels"

const lt: Lookup = (k) => (k in MESSAGES.lt ? MESSAGES.lt[k as keyof typeof MESSAGES.lt] : null)
const en: Lookup = (k) => (k in MESSAGES.en ? MESSAGES.en[k as keyof typeof MESSAGES.en] : null)
const ev = (action: string, extra: Partial<Parameters<typeof actionLabel>[1]> = {}) => ({ action, result: "success", targetType: "x", targetId: "x1", ...extra })

describe("audit URL filter", () => {
  it("round-trips through the query string and drops the default range", () => {
    const f = parseFilter(new URLSearchParams("range=custom&from=2026-11-01&to=2026-11-03&actor=usr_1&module=finance&result=denied&op=abc"))
    expect(f).toEqual({ range: "custom", from: "2026-11-01", to: "2026-11-03", actor: "usr_1", module: "finance", result: "denied", op: "abc" })
    expect(parseFilter(new URLSearchParams(filterToSearch(f)))).toEqual(f)
    expect(filterToSearch({ range: DEFAULT_RANGE })).toBe("")
    expect(isFiltered({ range: DEFAULT_RANGE })).toBe(false)
  })

  it("ignores junk values", () => {
    expect(parseFilter(new URLSearchParams("range=nope&result=maybe&from=yesterday&actor=%20%20"))).toEqual({ range: DEFAULT_RANGE })
    // Dates only count for the custom range.
    expect(parseFilter(new URLSearchParams("range=24h&from=2026-11-01"))).toEqual({ range: "24h" })
  })

  it("maps to listAudit args with filterOperationId and an inclusive end date", () => {
    const now = Date.UTC(2026, 10, 10)
    expect(toQueryArgs({ range: "24h", op: "op1", key: "key1", target: "t1", action: "role.assign" }, now)).toEqual({
      from: now - 24 * 3600_000,
      filterOperationId: "op1",
      apiKeyId: "key1",
      targetId: "t1",
      action: "role.assign",
    })
    const a = toQueryArgs({ range: "custom", from: "2026-11-01", to: "2026-11-01" }, now)
    expect(a.from).toBe(localDayStart("2026-11-01"))
    expect(a.to! - a.from!).toBe(new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime() - 1)
    expect(toQueryArgs({ range: "all" }, now)).toEqual({})
  })

  it("filters the result in the browser", () => {
    expect(matchesClient({ range: "all", result: "failed" }, { result: "success" })).toBe(false)
    expect(matchesClient({ range: "all" }, { result: "failed" })).toBe(true)
  })
})

describe("audit action labels", () => {
  it("labels known actions in both languages", () => {
    expect(actionLabel(lt, ev("role.assign"))).toBe("Priskirta rolė")
    expect(actionLabel(en, ev("finance.invoice.approve"))).toBe("Invoice approved")
    expect(actionLabel(en, ev("audit.export"))).toBe("Audit log exported (CSV)")
  })

  it("makes AI tool events readable", () => {
    expect(actionLabel(lt, ev("ai.tool.approve", { targetType: "aiToolCall", changes: { runId: "r", toolName: "finance.create_invoice" } }))).toBe("AI asistentas · Sukurti sąskaitą · patvirtinta")
    expect(actionLabel(en, ev("ai.tool.reject", { changes: { toolName: "finance.create_invoice" } }))).toBe("AI assistant · Create invoice · rejected")
    expect(actionLabel(lt, ev("ai.tool.run", { targetType: "ai_tool", targetId: "finance.approve_invoice", result: "denied" }))).toBe("AI asistentas · Patvirtinti sąskaitą · neleista")
    expect(actionLabel(en, ev("ai.tool.run", { targetId: "crm.find_lead" }))).toBe("AI assistant · Find lead · done")
  })

  it("falls back to the prefix, then the raw action", () => {
    expect(actionLabel(lt, ev("finance.invoice.cancel"))).toBe("Finansai · invoice.cancel")
    expect(actionLabel(lt, ev("crm.lead.create"))).toBe("crm.lead.create")
    expect(actionTypeLabel(lt, "ai.tool.approve")).toBe("AI asistentas · patvirtintas veiksmas")
    expect(moduleLabel(en, "api-keys")).toBe("API keys")
    expect(moduleLabel(en, "crm")).toBe("crm")
  })

  it("links a conversation only for its owner", () => {
    const e = ev("ai.message.send", { targetType: "aiThread", targetId: "th1", actorUserId: "u1" })
    expect(threadIdOf(e, "u1")).toBe("th1")
    expect(threadIdOf(e, "u2")).toBeNull()
    expect(threadIdOf(ev("ai.run.stop", { actorUserId: "u1", changes: { threadId: "th2" } }), "u1")).toBe("th2")
    expect(threadIdOf(ev("ai.tool.approve", { actorUserId: "u1", changes: { runId: "r" } }), "u1")).toBeNull()
  })
})
