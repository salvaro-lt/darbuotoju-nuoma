// The automation as a diagram: steps (Kanalas → AI ištraukimas → Veiksmas 1 → Veiksmas 2 →
// Rezultatas), what flows along each edge, a simple fixed layout, and step statuses
// from the latest real run or a test run. Pure: no React, unit-tested.
import type { AutomationDefinition, AutomationMode, AutomationTestResult, RunView, TestStepStatus } from "@digimuza/system-core/automations"

export type StepKind = "channel" | "extract" | "action" | "result"
/** `idle` before anything ran; `pending` → `running` → `ok` / `warning` / `error` during a test. */
export type StepStatus = "idle" | "pending" | "running" | "ok" | "warning" | "error" | "skipped"

export interface FlowStep {
  /** `channel`, `extract`, `action-0`, `action-1`, `result`. */
  id: string
  kind: StepKind
  /** Action index (actions only). */
  index?: number
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  /** Names of the data flowing along the edge (fields, `message.*`, `previous.*`). */
  data: string[]
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)?)\s*\}\}/g

/** Placeholders a mapping uses (`email`, `message.subject`, `previous.customerId`), in order, unique. */
export function mappingRefs(mapping: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const v of Object.values(mapping)) {
    if (typeof v !== "string") continue
    for (const m of v.matchAll(PLACEHOLDER)) if (!out.includes(m[1]!)) out.push(m[1]!)
  }
  return out
}

export const stepIds = (def: Pick<AutomationDefinition, "actions">): string[] => ["channel", "extract", ...def.actions.map((_, i) => `action-${i}`), "result"]

export function flowSteps(def: Pick<AutomationDefinition, "actions">): FlowStep[] {
  return [{ id: "channel", kind: "channel" }, { id: "extract", kind: "extract" }, ...def.actions.map((_, i) => ({ id: `action-${i}`, kind: "action" as const, index: i })), { id: "result", kind: "result" }]
}

/**
 * Edges and their data: the message goes to the extraction; the extracted fields (and
 * `message.*`) each action maps; `previous.*` from the first action to the second; the
 * last step hands over to review or insert.
 */
export function flowEdges(def: Pick<AutomationDefinition, "actions" | "extract">): FlowEdge[] {
  const ids = stepIds(def)
  const fieldNames = def.extract.fields.map((f) => f.name)
  const edges: FlowEdge[] = []
  for (let i = 0; i < ids.length - 1; i++) {
    const source = ids[i]!
    const target = ids[i + 1]!
    let data: string[] = []
    if (source === "channel") data = ["message.from", "message.subject", "message.text"]
    else if (target.startsWith("action-")) {
      const idx = Number(target.slice(7))
      const refs = mappingRefs(def.actions[idx]?.mapping ?? {})
      data = idx === 0 ? refs.filter((r) => !r.startsWith("previous.")) : refs.filter((r) => r.startsWith("previous.") || fieldNames.includes(r) || r.startsWith("message."))
    } else if (source === "extract") data = fieldNames
    edges.push({ id: `${source}->${target}`, source, target, data })
  }
  return edges
}

/** "a, b, c +2" for an edge chip. */
export function edgeLabel(data: readonly string[], max = 3): string {
  if (!data.length) return ""
  const head = data.slice(0, max).join(", ")
  return data.length > max ? `${head} +${data.length - max}` : head
}

export interface Box {
  width: number
  height: number
}

/**
 * Positions for a chain of boxes: left → right (centred vertically) or top → bottom
 * (centred horizontally), `gap` between them.
 */
export function layoutChain(boxes: readonly Box[], direction: "LR" | "TB", gap: number): { x: number; y: number }[] {
  const cross = Math.max(0, ...boxes.map((b) => (direction === "LR" ? b.height : b.width)))
  let at = 0
  return boxes.map((b) => {
    const pos = direction === "LR" ? { x: at, y: (cross - b.height) / 2 } : { x: (cross - b.width) / 2, y: at }
    at += (direction === "LR" ? b.width : b.height) + gap
    return pos
  })
}

const fromTest = (s: TestStepStatus): StepStatus => s

/** Step statuses of a finished test run. */
export function statusesFromTest(def: Pick<AutomationDefinition, "actions">, r: AutomationTestResult): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = { channel: fromTest(r.trigger.status), extract: fromTest(r.extract.status), result: fromTest(r.outcome.status) }
  def.actions.forEach((_, i) => {
    out[`action-${i}`] = r.actions[i] ? fromTest(r.actions[i]!.status) : "skipped"
  })
  if (r.outcome.wouldBe === "ignored") out.result = "skipped"
  return out
}

/** Step statuses of the latest real run (a small dot on each node). */
export function statusesFromRun(def: Pick<AutomationDefinition, "actions">, run: Pick<RunView, "status" | "extracted" | "errors" | "proposed" | "results" | "error">): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = { channel: "ok" }
  if (run.status === "queued") out.extract = "running"
  else if (!run.extracted) out.extract = run.status === "failed" ? "error" : "idle"
  else out.extract = run.errors.length ? "warning" : "ok"
  def.actions.forEach((_, i) => {
    const res = run.results[i]
    const prop = run.proposed[i]
    out[`action-${i}`] = res ? (res.ok ? "ok" : "error") : prop ? (prop.issues.length ? "warning" : "pending") : "idle"
  })
  out.result =
    run.status === "inserted" ? "ok" : run.status === "failed" ? "error" : run.status === "pending_review" ? "pending" : run.status === "rejected" ? "skipped" : run.status === "queued" ? "running" : "idle"
  return out
}

/**
 * The order in which a finished test is revealed on the diagram, starting from the
 * statuses shown while waiting (`from`): each reached step goes `running`, then its final
 * status, one after another; unreached steps end `skipped`. Frames without a visible
 * change are dropped.
 */
export function revealFrames(ids: readonly string[], final: Record<string, StepStatus>, from: Record<string, StepStatus> = {}): Record<string, StepStatus>[] {
  const frames: Record<string, StepStatus>[] = []
  const current: Record<string, StepStatus> = Object.fromEntries(ids.map((id) => [id, from[id] ?? ("pending" as StepStatus)]))
  const push = () => {
    const last = frames.at(-1)
    if (!last || ids.some((id) => last[id] !== current[id])) frames.push({ ...current })
  }
  for (const id of ids) {
    const end = final[id] ?? "skipped"
    if (end === "skipped") {
      current[id] = "skipped"
      continue
    }
    current[id] = "running"
    push()
    current[id] = end
    push()
  }
  push()
  return frames
}

/** A sample to start from: the extraction's fields as an example JSON body (webhook). */
export function exampleJson(def: Pick<AutomationDefinition, "extract" | "trigger">): string {
  const sample: Record<string, string> = {}
  if (def.trigger.filters?.formId) sample.form_id = def.trigger.filters.formId
  for (const f of def.extract.fields.slice(0, 6)) {
    sample[f.name] = f.type === "email" ? "jonas@example.com" : f.type === "phone" ? "+370 600 00000" : f.type === "number" ? "2" : f.type === "date" ? "2030-03-01" : f.type === "enum" ? (f.options?.[0] ?? "") : f.name === "name" ? "Jonas Jonaitis" : ""
  }
  sample.message = sample.message || "Sveiki, reikia iškabos 2×1 m."
  return JSON.stringify(sample, null, 2)
}

/** `key: value` lines → form fields. */
export function parseFieldLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":")
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    if (k) out[k] = line.slice(i + 1).trim()
  }
  return out
}

export const modeLabelKey = (mode: AutomationMode) => (mode === "auto" ? "auto.mode.auto" : "auto.mode.review")
