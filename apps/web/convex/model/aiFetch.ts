// Request middleware for the AI runner's fetch.
//
// With streaming, 9Router's Claude Haiku 5.5 often (5 of 6 tries in a test)
// starts the answer with an empty "<think></think>", which would show in the
// chat. Disabling thinking stops it (11 of 11 clean). Only fast models get the
// flag: `smart` keeps its reasoning.

/** Models that get `thinking: { type: "disabled" }`: the `fast` combo and Haiku ids. */
export const isFastModel = (model: unknown) => typeof model === "string" && (model === "fast" || /haiku/i.test(model))

export function withoutThinkingForFastModels(base: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    if (typeof init?.body !== "string" || !String(input instanceof Request ? input.url : input).endsWith("/chat/completions")) return base(input, init)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(init.body) as Record<string, unknown>
    } catch {
      return base(input, init)
    }
    if (!isFastModel(body.model) || "thinking" in body) return base(input, init)
    return base(input, { ...init, body: JSON.stringify({ ...body, thinking: { type: "disabled" } }) })
  }
}
