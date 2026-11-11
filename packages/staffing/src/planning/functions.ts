// Guarded Convex functions of the "planning" area. Each one: guard
// (permission + module enabled) → checks → write → audit, and returns
// `operationId`. Re-export them from the app's `convex/planning.ts`.
import { mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { isBlockingAssignment, rangesOverlap, todayIso, type AvailabilityKind } from "../pure"
import { actorArgs, actorId, checkRange, cleanDate, cleanText, fail, opts, writerOf } from "../shared"
import { availabilityKindValidator } from "../tables"
import { StaffingPlanningPermissions as P } from "./manifest"
import { loadCatalog, loadPlanData, planningReader, workerClientHistory, type ClientHistory, type PlanningDataModel } from "./operations"
import { capacityAnswer, capacityReply, nextMonday, supplyDemand, weekCell, weeksFrom, workerStatusOn, type BoardWeek, type CapacityAnswer, type PlanDemand, type WeekCell, type WorkerPlanStatus } from "./pure"
import { DEFAULT_TEAM_RULES, type TeamRules } from "./rules"
import { definePlanningSeed } from "./seed"
import { englishScopeValidator, feedbackVerdictValidator } from "./tables"

const wr = (ctx: { db: unknown }) => writerOf<PlanningDataModel>(ctx)

export interface BoardTrade {
  id: string
  code: string
  nameLt: string
  nameEn: string
}
export interface BoardRow {
  worker: { id: string; name: string; nationality: string; languages: string[]; source: "own" | "subcontractor"; subcontractorName: string | null; tradeIds: string[] }
  status: WorkerPlanStatus
  cells: WeekCell[]
}
export interface BoardView {
  today: string
  /** Default "from" for the capacity question: next Monday. */
  nextMonday: string
  weeks: BoardWeek[]
  /** Trades with any supply or demand in the period, in catalog order. */
  trades: BoardTrade[]
  rows: BoardRow[]
  demand: PlanDemand[]
}
export interface AvailabilityView {
  id: string
  kind: AvailabilityKind
  startDate: string
  endDate: string | null
  note: string
}
export interface WorkerPlanningView {
  status: WorkerPlanStatus
  availability: AvailabilityView[]
  history: ClientHistory[]
  /** Clients (not pure subcontractors) for a new feedback note. */
  clients: { id: string; name: string }[]
}
export interface CapacityView extends CapacityAnswer {
  tradeNames: { lt: string; en: string }
  reply: { lt: { internal: string; client: string }; en: { internal: string; client: string } }
}
export interface SettingsView {
  subcontractors: { id: string; name: string; code: string }[]
  clients: { id: string; name: string; code: string }[]
  capacities: { id: string; clientId: string; clientName: string; tradeId: string; tradeName: string; tradeNameEn: string; count: number; validFrom: string; validTo: string | null; note: string }[]
  rules: (TeamRules & { clientId: string; clientName: string; note: string; stored: boolean })[]
  defaults: TeamRules
}

const MAX_WEEKS = 12

/** "suvirintojų" for a group of welding trades, else the trade's name. */
export function tradeGroupNames(trades: readonly { code: string; nameLt: string; nameEn: string }[]): { lt: string; en: string } {
  if (trades.length > 1 && trades.every((t) => t.code.startsWith("WELD"))) return { lt: "suvirintojų", en: "welders" }
  if (trades.length === 1) return { lt: `žm. (${trades[0]!.nameLt})`, en: `× ${trades[0]!.nameEn}` }
  return { lt: `žm. (${trades.map((t) => t.nameLt).join(" / ")})`, en: `× ${trades.map((t) => t.nameEn).join(" / ")}` }
}

/** The capacity answer for trades (IDs) with both replies. Shared by the query and the AI tool. */
export async function capacityFor(ctx: { db: unknown }, q: { tradeIds: string[]; count: number; from: string; to?: string | undefined }, today = todayIso()): Promise<CapacityView> {
  const catalog = await loadCatalog(ctx)
  const data = await loadPlanData(ctx, { from: today < q.from ? today : q.from })
  const a = capacityAnswer({ ...q, today }, data, { client: (id) => data.clientNames.get(id) ?? "?" })
  const trades = q.tradeIds.map((id) => catalog.trades.get(id)).filter((t) => t !== undefined)
  const tradeNames = tradeGroupNames(trades)
  return { ...a, tradeNames, reply: { lt: capacityReply(a, tradeNames, "lt"), en: capacityReply(a, tradeNames, "en") } }
}

export function definePlanning(system: ConvexSystem) {
  return {
    /**
     * The weekly planning board: `weeks` weeks (default 8) from the week of
     * `from` (default today). Supply vs demand per week and trade, and every
     * active worker as a timeline of week cells.
     */
    getBoard: queryGeneric({
      args: { ...actorArgs, from: v.optional(v.string()), weeks: v.optional(v.number()) },
      handler: async (ctx, a): Promise<BoardView> => {
        const { sys } = await system.requirePermission(ctx, P.boardRead, opts(a))
        const op = sys.operationId
        const today = todayIso()
        const from = cleanDate(a.from, "from", op) ?? today
        const count = Math.max(1, Math.min(MAX_WEEKS, Math.round(a.weeks ?? 8)))
        const weeks = weeksFrom(from, count)
        const catalog = await loadCatalog(ctx)
        const data = await loadPlanData(ctx, { from: weeks[0]!.start })
        const board = supplyDemand(
          weeks,
          data,
          catalog.tradeList.map((t) => t._id),
        )
        const used = new Set(board.flatMap((w) => w.trades.filter((t) => t.supply > 0 || t.demand > 0).map((t) => t.tradeId)))
        for (const w of board) w.trades = w.trades.filter((t) => used.has(t.tradeId))
        const rows: BoardRow[] = data.workers
          .map((w) => ({
            worker: {
              id: w.id,
              name: w.name,
              nationality: w.nationality,
              languages: [...w.languages],
              source: w.source,
              subcontractorName: w.subcontractorClientId ? (data.clientNames.get(w.subcontractorClientId) ?? null) : null,
              tradeIds: [...w.tradeIds],
            },
            status: workerStatusOn(w.id, today, data),
            cells: weeks.map((wk) => weekCell(w.id, wk, data)),
          }))
          .sort((x, y) => x.worker.name.localeCompare(y.worker.name))
        return {
          today,
          nextMonday: nextMonday(today),
          weeks: board,
          trades: catalog.tradeList.filter((t) => used.has(t._id)).map((t) => ({ id: t._id, code: t.code, nameLt: t.nameLt, nameEn: t.nameEn })),
          rows,
          demand: [...data.demand],
        }
      },
    }),

    /** "Ar turime 20 suvirintojų nuo pirmadienio?": counts by source and a short reply. */
    capacity: queryGeneric({
      args: { ...actorArgs, tradeIds: v.array(v.id("staffing_trades")), count: v.number(), from: v.string(), to: v.optional(v.string()) },
      handler: async (ctx, a): Promise<CapacityView> => {
        const { sys } = await system.requirePermission(ctx, P.boardRead, opts(a))
        const op = sys.operationId
        const from = cleanDate(a.from, "from", op)!
        const to = cleanDate(a.to, "to", op)
        checkRange(from, to, op, "to")
        if (!a.tradeIds.length) fail("VALIDATION", "missing_tradeIds", op, ["tradeIds"])
        if (!Number.isInteger(a.count) || a.count < 1 || a.count > 500) fail("VALIDATION", "invalid_count", op, ["count"])
        return capacityFor(ctx, { tradeIds: a.tradeIds, count: a.count, from, to })
      },
    }),

    /** A worker's planning card: Dirba / Namuose / Rezerve, rest periods, history and feedback per client. */
    getWorkerPlanning: queryGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers") },
      handler: async (ctx, a): Promise<WorkerPlanningView | null> => {
        await system.requirePermission(ctx, P.boardRead, opts(a))
        const db = planningReader(ctx)
        const w = await db.get("staffing_workers", a.workerId)
        if (!w) return null
        const today = todayIso()
        const data = await loadPlanData(ctx, { from: today })
        const rows = await db
          .query("staffing_workerAvailability")
          .withIndex("by_worker", (q) => q.eq("workerId", w._id))
          .collect()
        const clients = (await db.query("staffing_clients").take(1000)).filter((c) => c.kind !== "subcontractor").sort((x, y) => x.name.localeCompare(y.name))
        return {
          status: workerStatusOn(w._id, today, {
            assignments: data.assignments,
            availability: rows.map((p) => ({ workerId: p.workerId, kind: p.kind, startDate: p.startDate, endDate: p.endDate ?? null, note: p.note })),
          }),
          availability: rows.map((p) => ({ id: p._id, kind: p.kind, startDate: p.startDate, endDate: p.endDate ?? null, note: p.note })).sort((x, y) => y.startDate.localeCompare(x.startDate)),
          history: await workerClientHistory(ctx, w._id, today),
          clients: clients.map((c) => ({ id: c._id, name: c.name })),
        }
      },
    }),

    /**
     * Marks a period away: `rest` (home to rest, e.g. 2 weeks), `unavailable`,
     * or `available_from` (not before `startDate`). Overlapping a confirmed
     * assignment is allowed (the end of a project): `overlapsAssignment` tells.
     */
    addAvailability: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), kind: availabilityKindValidator, startDate: v.string(), endDate: v.optional(v.string()), note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.availabilityWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const w = await db.get("staffing_workers", a.workerId)
        if (!w) fail("NOT_FOUND", "worker_not_found", op)
        const startDate = cleanDate(a.startDate, "startDate", op)
        if (!startDate) fail("VALIDATION", "missing_startDate", op, ["startDate"])
        const endDate = a.kind === "available_from" ? undefined : cleanDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        const note = cleanText(a.note, 300, "note", op, false) ?? ""
        const id = await db.insert("staffing_workerAvailability", { workerId: w._id, kind: a.kind, startDate, ...(endDate ? { endDate } : {}), note, createdBy: actorId(actor), updatedAt: Date.now() })
        const range = a.kind === "available_from" ? { startDate: "0000-01-01", endDate: startDate } : { startDate, endDate }
        const overlapsAssignment = (
          await db
            .query("staffing_assignments")
            .withIndex("by_worker", (q) => q.eq("workerId", w._id))
            .collect()
        ).some((x) => isBlockingAssignment(x) && rangesOverlap(x, range) && (x.endDate ?? "9999") >= todayIso())
        await recordAudit(sys, actor, { action: "staffing-planning.availability.create", targetType: "staffing_workerAvailability", targetId: id, changes: { workerId: w._id, kind: a.kind, startDate, endDate: endDate ?? null } })
        return { id, overlapsAssignment, operationId: op }
      },
    }),

    deleteAvailability: mutationGeneric({
      args: { ...actorArgs, availabilityId: v.id("staffing_workerAvailability") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.availabilityWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const row = await db.get("staffing_workerAvailability", a.availabilityId)
        if (!row) fail("NOT_FOUND", "availability_not_found", op)
        await db.delete("staffing_workerAvailability", row._id)
        await recordAudit(sys, actor, { action: "staffing-planning.availability.delete", targetType: "staffing_workerAvailability", targetId: row._id, changes: { workerId: row.workerId, kind: row.kind } })
        return { operationId: op }
      },
    }),

    /** The planner's verdict on a worker for a client (one per pair; replaces the previous). */
    setFeedback: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), clientId: v.id("staffing_clients"), verdict: feedbackVerdictValidator, comment: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.feedbackWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        if (!(await db.get("staffing_workers", a.workerId))) fail("NOT_FOUND", "worker_not_found", op)
        if (!(await db.get("staffing_clients", a.clientId))) fail("VALIDATION", "invalid_clientId", op, ["clientId"])
        const comment = cleanText(a.comment, 1000, "comment", op, a.verdict === "unsuitable") ?? ""
        const prior = await db
          .query("staffing_planning_feedback")
          .withIndex("by_worker", (q) => q.eq("workerId", a.workerId).eq("clientId", a.clientId))
          .first()
        const now = Date.now()
        const id = prior
          ? (await db.patch("staffing_planning_feedback", prior._id, { verdict: a.verdict, comment, createdBy: actorId(actor), updatedAt: now }), prior._id)
          : await db.insert("staffing_planning_feedback", { workerId: a.workerId, clientId: a.clientId, verdict: a.verdict, comment, createdBy: actorId(actor), updatedAt: now })
        await recordAudit(sys, actor, { action: "staffing-planning.feedback.set", targetType: "staffing_planning_feedback", targetId: id, changes: { workerId: a.workerId, clientId: a.clientId, verdict: a.verdict } })
        return { id, operationId: op }
      },
    }),

    deleteFeedback: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), clientId: v.id("staffing_clients") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.feedbackWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const row = await db
          .query("staffing_planning_feedback")
          .withIndex("by_worker", (q) => q.eq("workerId", a.workerId).eq("clientId", a.clientId))
          .first()
        if (!row) fail("NOT_FOUND", "feedback_not_found", op)
        await db.delete("staffing_planning_feedback", row._id)
        await recordAudit(sys, actor, { action: "staffing-planning.feedback.delete", targetType: "staffing_planning_feedback", targetId: row._id, changes: { workerId: a.workerId, clientId: a.clientId } })
        return { operationId: op }
      },
    }),

    /** Subcontractor capacities and client team rules. */
    getSettings: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<SettingsView> => {
        await system.requirePermission(ctx, P.boardRead, opts(a))
        const db = planningReader(ctx)
        const catalog = await loadCatalog(ctx)
        const clients = (await db.query("staffing_clients").take(1000)).sort((x, y) => x.name.localeCompare(y.name))
        const names = new Map(clients.map((c) => [c._id as string, c.name]))
        const capacities = (await db.query("staffing_planning_capacities").take(2000))
          .map((c) => {
            const t = catalog.trades.get(c.tradeId)
            return { id: c._id, clientId: c.clientId, clientName: names.get(c.clientId) ?? "?", tradeId: c.tradeId, tradeName: t?.nameLt ?? "?", tradeNameEn: t?.nameEn ?? "?", count: c.count, validFrom: c.validFrom, validTo: c.validTo ?? null, note: c.note }
          })
          .sort((x, y) => x.clientName.localeCompare(y.clientName) || x.tradeName.localeCompare(y.tradeName))
        const stored = await db.query("staffing_planning_clientRules").take(1000)
        const rules = stored
          .map((r) => ({ ...DEFAULT_TEAM_RULES, driversPerPeople: r.driversPerPeople, english: r.english, languageCompatibility: r.languageCompatibility, housingGroupSize: r.housingGroupSize, clientId: r.clientId as string, clientName: names.get(r.clientId) ?? "?", note: r.note, stored: true }))
          .sort((x, y) => x.clientName.localeCompare(y.clientName))
        return {
          subcontractors: clients.filter((c) => c.kind !== "client").map((c) => ({ id: c._id, name: c.name, code: c.code })),
          clients: clients.filter((c) => c.kind !== "subcontractor").map((c) => ({ id: c._id, name: c.name, code: c.code })),
          capacities,
          rules,
          defaults: DEFAULT_TEAM_RULES,
        }
      },
    }),

    /** Creates or (with `capacityId`) replaces a subcontractor's declared capacity for a trade. */
    saveCapacity: mutationGeneric({
      args: {
        ...actorArgs,
        capacityId: v.optional(v.id("staffing_planning_capacities")),
        clientId: v.id("staffing_clients"),
        tradeId: v.id("staffing_trades"),
        count: v.number(),
        validFrom: v.string(),
        validTo: v.optional(v.string()),
        note: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.settingsWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const client = await db.get("staffing_clients", a.clientId)
        if (!client || client.kind === "client") fail("VALIDATION", "not_a_subcontractor", op, ["clientId"])
        if (!(await db.get("staffing_trades", a.tradeId))) fail("VALIDATION", "invalid_tradeId", op, ["tradeId"])
        if (!Number.isInteger(a.count) || a.count < 0 || a.count > 500) fail("VALIDATION", "invalid_count", op, ["count"])
        const validFrom = cleanDate(a.validFrom, "validFrom", op)
        if (!validFrom) fail("VALIDATION", "missing_validFrom", op, ["validFrom"])
        const validTo = cleanDate(a.validTo, "validTo", op)
        checkRange(validFrom, validTo, op, "validTo")
        const row = { clientId: a.clientId, tradeId: a.tradeId, count: a.count, validFrom, validTo, note: cleanText(a.note, 300, "note", op, false) ?? "", createdBy: actorId(actor), updatedAt: Date.now() }
        let id = a.capacityId
        if (id) {
          if (!(await db.get("staffing_planning_capacities", id))) fail("NOT_FOUND", "capacity_not_found", op)
          await db.replace("staffing_planning_capacities", id, row.validTo ? row : { ...row, validTo: undefined })
        } else id = await db.insert("staffing_planning_capacities", row.validTo ? row : { ...row, validTo: undefined })
        await recordAudit(sys, actor, { action: a.capacityId ? "staffing-planning.capacity.update" : "staffing-planning.capacity.create", targetType: "staffing_planning_capacities", targetId: id, changes: { clientId: a.clientId, tradeId: a.tradeId, count: a.count } })
        return { id, operationId: op }
      },
    }),

    deleteCapacity: mutationGeneric({
      args: { ...actorArgs, capacityId: v.id("staffing_planning_capacities") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.settingsWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const row = await db.get("staffing_planning_capacities", a.capacityId)
        if (!row) fail("NOT_FOUND", "capacity_not_found", op)
        await db.delete("staffing_planning_capacities", row._id)
        await recordAudit(sys, actor, { action: "staffing-planning.capacity.delete", targetType: "staffing_planning_capacities", targetId: row._id })
        return { operationId: op }
      },
    }),

    /** The client's team rules (one row per client). */
    saveClientRules: mutationGeneric({
      args: {
        ...actorArgs,
        clientId: v.id("staffing_clients"),
        driversPerPeople: v.number(),
        english: englishScopeValidator,
        languageCompatibility: v.boolean(),
        housingGroupSize: v.number(),
        note: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.settingsWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        if (!(await db.get("staffing_clients", a.clientId))) fail("VALIDATION", "invalid_clientId", op, ["clientId"])
        if (!Number.isInteger(a.driversPerPeople) || a.driversPerPeople < 0 || a.driversPerPeople > 50) fail("VALIDATION", "invalid_driversPerPeople", op, ["driversPerPeople"])
        if (!Number.isInteger(a.housingGroupSize) || a.housingGroupSize < 1 || a.housingGroupSize > 20) fail("VALIDATION", "invalid_housingGroupSize", op, ["housingGroupSize"])
        const row = {
          clientId: a.clientId,
          driversPerPeople: a.driversPerPeople,
          english: a.english,
          languageCompatibility: a.languageCompatibility,
          housingGroupSize: a.housingGroupSize,
          note: cleanText(a.note, 300, "note", op, false) ?? "",
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        }
        const prior = await db
          .query("staffing_planning_clientRules")
          .withIndex("by_client", (q) => q.eq("clientId", a.clientId))
          .first()
        const id = prior ? (await db.replace("staffing_planning_clientRules", prior._id, row), prior._id) : await db.insert("staffing_planning_clientRules", row)
        await recordAudit(sys, actor, { action: "staffing-planning.rules.set", targetType: "staffing_planning_clientRules", targetId: id, changes: { clientId: a.clientId, driversPerPeople: a.driversPerPeople, english: a.english } })
        return { id, operationId: op }
      },
    }),

    /** Back to the default rules for the client. */
    deleteClientRules: mutationGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.settingsWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const row = await db
          .query("staffing_planning_clientRules")
          .withIndex("by_client", (q) => q.eq("clientId", a.clientId))
          .first()
        if (!row) fail("NOT_FOUND", "rules_not_found", op)
        await db.delete("staffing_planning_clientRules", row._id)
        await recordAudit(sys, actor, { action: "staffing-planning.rules.delete", targetType: "staffing_planning_clientRules", targetId: row._id })
        return { operationId: op }
      },
    }),

    ...definePlanningSeed(),
  }
}

export type PlanningFunctions = ReturnType<typeof definePlanning>
