import type { AutomationDefinition, AutomationTestResult } from "@digimuza/system-core/automations"
import { describe, expect, test } from "vitest"
import { edgeLabel, exampleJson, flowEdges, flowSteps, layoutChain, mappingRefs, parseFieldLines, revealFrames, statusesFromRun, statusesFromTest, stepIds } from "./model"

const def: AutomationDefinition = {
  name: "Užklausos",
  trigger: { channel: "email" },
  extract: {
    instructions: "x",
    fields: [
      { name: "name", type: "string", required: true },
      { name: "email", type: "email", required: false },
      { name: "product", type: "string", required: false },
    ],
  },
  actions: [
    { targetId: "crm.find_or_create_customer", mapping: { name: "{{name}}", email: "{{ email }}", source: "email" } },
    { targetId: "crm.create_inquiry", mapping: { customerId: "{{previous.customerId}}", subject: "{{message.subject}}", body: "{{message.text}}\n{{product}}" } },
  ],
}

describe("automation flow model", () => {
  test("steps and the data on each edge", () => {
    expect(stepIds(def)).toEqual(["channel", "extract", "action-0", "action-1", "result"])
    expect(flowSteps({ actions: [] }).map((s) => s.id)).toEqual(["channel", "extract", "result"])
    expect(mappingRefs(def.actions[1]!.mapping)).toEqual(["previous.customerId", "message.subject", "message.text", "product"])
    const edges = flowEdges(def)
    expect(edges.map((e) => [e.id, e.data])).toEqual([
      ["channel->extract", ["message.from", "message.subject", "message.text"]],
      ["extract->action-0", ["name", "email"]],
      ["action-0->action-1", ["previous.customerId", "message.subject", "message.text", "product"]],
      ["action-1->result", []],
    ])
    expect(edgeLabel(["a", "b", "c", "d"], 2)).toBe("a, b +2")
    expect(edgeLabel([])).toBe("")
  })

  test("chain layout centres the cross axis", () => {
    expect(layoutChain([{ width: 100, height: 50 }, { width: 80, height: 100 }], "LR", 10)).toEqual([
      { x: 0, y: 25 },
      { x: 110, y: 0 },
    ])
    expect(layoutChain([{ width: 100, height: 50 }, { width: 80, height: 100 }], "TB", 10)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 60 },
    ])
  })

  test("statuses from a test and from the latest run", () => {
    const r = {
      trigger: { status: "ok", reason: null, durationMs: 0 },
      extract: { status: "warning", values: {}, errors: ["email: required"], attempts: 2, usage: null, error: null, durationMs: 900 },
      actions: [
        { index: 0, targetId: "a", status: "ok", input: {}, issues: [], simulated: { kind: "preview", result: {} }, durationMs: 3 },
        { index: 1, targetId: "b", status: "error", input: {}, issues: ["body: required"], simulated: { kind: "placeholder", result: null }, durationMs: 1 },
      ],
      outcome: { status: "warning", wouldBe: "pending_review", reason: "validation" },
    } as unknown as AutomationTestResult
    expect(statusesFromTest(def, r)).toEqual({ channel: "ok", extract: "warning", "action-0": "ok", "action-1": "error", result: "warning" })
    const run = { status: "pending_review", extracted: { name: "x" }, errors: [], proposed: [{ targetId: "a", input: {}, issues: [] }, { targetId: "b", input: {}, issues: ["x"] }], results: [], error: null } as const
    expect(statusesFromRun(def, run as never)).toEqual({ channel: "ok", extract: "ok", "action-0": "pending", "action-1": "warning", result: "pending" })
    expect(statusesFromRun(def, { ...run, status: "failed", extracted: null } as never).extract).toBe("error")
  })

  test("reveal frames run each reached step in order and continue from the waiting state", () => {
    const ids = ["channel", "extract", "result"]
    const frames = revealFrames(ids, { channel: "ok", extract: "error", result: "error" }, { channel: "running", extract: "running", result: "pending" })
    expect(frames[0]).toEqual({ channel: "running", extract: "running", result: "pending" })
    expect(frames.at(-1)).toEqual({ channel: "ok", extract: "error", result: "error" })
    expect(frames.some((f) => f.result === "running")).toBe(true)
    const ignored = revealFrames(ids, { channel: "error", extract: "skipped", result: "skipped" })
    expect(ignored.at(-1)).toEqual({ channel: "error", extract: "skipped", result: "skipped" })
  })

  test("example webhook body passes the form filter", () => {
    expect(JSON.parse(exampleJson({ ...def, trigger: { channel: "webhook", filters: { formId: "kontaktai" } } }))).toMatchObject({ form_id: "kontaktai", name: "Jonas Jonaitis", email: "jonas@example.com" })
  })

  test("form field lines", () => {
    expect(parseFieldLines("name: Jonas\n\nbad line\nmessage: a: b")).toEqual({ name: "Jonas", message: "a: b" })
  })
})
