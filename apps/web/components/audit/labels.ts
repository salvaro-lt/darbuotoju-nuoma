// Human-readable audit actions. Pure: the caller passes `tr`, a message lookup
// that returns null for unknown keys, so the raw action can be the fallback.

export type Lookup = (key: string) => string | null

export interface AuditLabelEvent {
  action: string
  result: string
  targetType: string
  targetId: string
  actorUserId?: string
  changes?: Record<string, unknown>
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

/** "create_invoice" → "Create invoice" (last resort for tools without a label). */
function humanize(id: string) {
  const s = id.replace(/[_\-.]+/g, " ").trim().toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Label of an AI tool id (`ai.toolLabel.<id>`), else its humanized last segment. */
export function toolName(tr: Lookup, toolId: string) {
  return tr(`ai.toolLabel.${toolId}`) ?? humanize(toolId.split(".").pop() ?? toolId)
}

/**
 * Readable action: a known action's label, AI tool events as
 * "AI asistentas · Sukurti sąskaitą · patvirtinta", a known prefix with the rest
 * of the raw action, or the raw action.
 */
export function actionLabel(tr: Lookup, e: AuditLabelEvent): string {
  const ai = tr("audit.prefix.ai") ?? "AI"
  if (e.action === "ai.tool.run") {
    const state = e.result === "success" ? tr("audit.ai.done") : e.result === "denied" ? tr("audit.ai.denied") : tr("audit.ai.failed")
    return [ai, toolName(tr, e.targetId), state].filter(Boolean).join(" · ")
  }
  if (e.action === "ai.tool.approve" || e.action === "ai.tool.reject") {
    const tool = str(e.changes?.toolName)
    const state = tr(e.action === "ai.tool.approve" ? "audit.ai.approved" : "audit.ai.rejected")
    return [ai, tool ? toolName(tr, tool) : null, state].filter(Boolean).join(" · ")
  }
  return actionTypeLabel(tr, e.action)
}

/** Label of an action as a kind of event (filter lists): known label, known prefix + rest, or raw. */
export function actionTypeLabel(tr: Lookup, action: string): string {
  const known = tr(`audit.action.${action}`)
  if (known) return known
  const dot = action.indexOf(".")
  const prefix = dot > 0 ? tr(`audit.prefix.${action.slice(0, dot)}`) : null
  return prefix ? `${prefix} · ${action.slice(dot + 1)}` : action
}

/** Module label (`audit.module.<id>`), else the raw ID. */
export function moduleLabel(tr: Lookup, moduleId: string) {
  return tr(`audit.module.${moduleId}`) ?? moduleId
}

/**
 * AI conversation an event belongs to, when the event itself names it and the
 * viewer owns it (threads are private: anyone else's link would be "not found").
 */
export function threadIdOf(e: AuditLabelEvent, viewerUserId: string | null | undefined): string | null {
  if (!viewerUserId || e.actorUserId !== viewerUserId) return null
  if (e.action === "ai.thread.create" || e.action === "ai.message.send") return e.targetType === "aiThread" ? e.targetId : null
  if (e.action === "ai.run.stop") return str(e.changes?.threadId)
  return null
}
