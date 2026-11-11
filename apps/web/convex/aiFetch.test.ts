import { describe, expect, it, vi } from "vitest"
import { isFastModel, withoutThinkingForFastModels } from "./model/aiFetch"

const URL_ = "https://router.digimuza.ai/v1/chat/completions"
const sent = async (model: string, extra: Record<string, unknown> = {}, url = URL_) => {
  const base = vi.fn(async () => new Response("{}"))
  await withoutThinkingForFastModels(base as unknown as typeof fetch)(url, { method: "POST", body: JSON.stringify({ model, stream: true, ...extra }) })
  const init = (base.mock.calls[0] as unknown as [string, RequestInit])[1]
  return JSON.parse(init.body as string) as Record<string, unknown>
}

describe("withoutThinkingForFastModels", () => {
  it("disables thinking for the fast combo and Haiku ids", async () => {
    expect(await sent("fast")).toMatchObject({ model: "fast", stream: true, thinking: { type: "disabled" } })
    expect((await sent("cc/claude-haiku-5-5")).thinking).toEqual({ type: "disabled" })
  })

  it("leaves other models, explicit thinking and other endpoints alone", async () => {
    expect(await sent("smart")).not.toHaveProperty("thinking")
    expect((await sent("fast", { thinking: { type: "enabled" } })).thinking).toEqual({ type: "enabled" })
    expect(await sent("fast", {}, "https://router.digimuza.ai/v1/models")).not.toHaveProperty("thinking")
  })

  it("matches model names", () => {
    expect([isFastModel("fast"), isFastModel("cc/claude-haiku-4-5-20251001"), isFastModel("smart"), isFastModel(undefined)]).toEqual([true, true, false, false])
  })
})
