// AI tools of the staffing base, read-only. Give them to an agent:
//   defineAiAgent({ id: "assistant", ..., tools: [...staffingTools] })
import { defineAiTool } from "@digimuza/system-core/ai"
import { z } from "zod"
import { StaffingPermissions } from "./manifest"
import { getWorkerCard, listAvailableWorkers, loadCatalog, workerSummaries } from "./operations"
import { fold, isIsoDate, PROJECT_STATUSES, todayIso, WORKER_SOURCES, WORKER_STATUSES } from "./pure"
import { readerOf, type WorkerId } from "./shared"

const date = z.string().refine(isIsoDate, "YYYY-MM-DD")

/** Trade codes or names → trade IDs (case and accent insensitive). */
async function tradeIds(ctx: { db: unknown }, names: string[] | undefined) {
  if (!names?.length) return undefined
  const { tradeList } = await loadCatalog(ctx)
  const wanted = names.map(fold)
  return tradeList.filter((t) => wanted.some((n) => fold(t.code) === n || fold(t.nameLt).includes(n) || fold(t.nameEn).includes(n))).map((t) => t._id)
}

export const staffingListWorkersTool = defineAiTool({
  id: "staffing.list_workers",
  description:
    "Lists workers (welders, fitters, …) with their trades, nationality, source (own or subcontractor), status and worst certificate status today (valid, expiring60, expiring30, expired, missing). Optional filters: name search, trade, status, source.",
  permission: StaffingPermissions.workerRead,
  input: z.object({
    search: z.string().trim().max(100).optional().describe("Part of a name, phone or city"),
    trade: z.string().trim().max(60).optional().describe("Trade code or name, e.g. WELD-MAG or suvirintojas"),
    status: z.enum(WORKER_STATUSES).optional(),
    source: z.enum(WORKER_SOURCES).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 50"),
  }),
  handler: async (ctx, input) => {
    const db = readerOf(ctx)
    const trades = await tradeIds(ctx, input.trade ? [input.trade] : undefined)
    const needle = input.search ? fold(input.search) : ""
    const rows = (await db.query("staffing_workers").take(2000)).filter(
      (w) =>
        (!input.status || w.status === input.status) &&
        (!input.source || w.source === input.source) &&
        (!needle || w.searchText.includes(needle)) &&
        (!trades || w.trades.some((t) => trades.includes(t.tradeId))),
    )
    const list = await workerSummaries(ctx, rows.slice(0, input.limit ?? 50))
    return {
      total: rows.length,
      workers: list.map((w) => ({
        name: w.fullName,
        trades: w.trades.map((t) => `${t.nameEn} (${t.level})`),
        nationality: w.nationality,
        source: w.subcontractorName ? `subcontractor: ${w.subcontractorName}` : w.source,
        status: w.status,
        certificates: w.certStatus,
        link: `/app/staffing/workers/${w.id}`,
      })),
    }
  },
})

export const staffingGetWorkerTool = defineAiTool({
  id: "staffing.get_worker",
  description: "One worker's card: contacts, trades, driving licences, certificates with expiry and status, current and next assignment. Find the worker by name or ID.",
  permission: StaffingPermissions.workerRead,
  input: z.object({ name: z.string().trim().min(1).max(100).describe("Worker's name (or part of it) or ID") }),
  handler: async (ctx, input) => {
    const db = readerOf(ctx)
    const byId = await db.get("staffing_workers", input.name as WorkerId).catch(() => null)
    const needle = fold(input.name)
    const w = byId ?? (await db.query("staffing_workers").take(2000)).find((x) => x.searchText.includes(needle) || fold(`${x.lastName} ${x.firstName}`).includes(needle))
    if (!w) return { found: false }
    const card = (await getWorkerCard(ctx, w._id))!
    const a = (x: typeof card.current) => (x ? { project: `${x.projectCode} ${x.projectName}`, client: x.clientName, trade: x.tradeName, from: x.startDate, to: x.endDate, status: x.status } : null)
    return {
      found: true,
      name: card.worker.fullName,
      phone: card.worker.phone,
      email: card.worker.email,
      nationality: card.worker.nationality,
      languages: card.worker.languages,
      status: card.worker.status,
      source: card.worker.subcontractorName ?? card.worker.source,
      trades: card.worker.trades.map((t) => ({ trade: t.nameEn, level: t.level })),
      driverLicence: card.worker.driverLicenseCategories,
      certificates: card.certificates.map((c) => ({ type: c.typeNameEn ?? c.typeName, number: c.number, expiresAt: c.expiresAt, status: c.status })),
      missingMandatory: card.missingMandatory.map((t) => t.nameEn ?? t.name),
      currentAssignment: a(card.current),
      nextAssignment: a(card.next),
      link: `/app/staffing/workers/${w._id}`,
    }
  },
})

export const staffingFindAvailableWorkersTool = defineAiTool({
  id: "staffing.find_available_workers",
  description:
    "Active workers free for a whole period (no confirmed or active assignment overlapping it), optionally only some trades and only those whose mandatory certificates are valid on the last day. Use it to propose a team for a client request.",
  permission: StaffingPermissions.workerRead,
  input: z.object({
    from: date.describe("First day, YYYY-MM-DD"),
    to: date.optional().describe("Last day, YYYY-MM-DD; omit for open-ended"),
    trades: z.array(z.string().trim().min(1).max(60)).max(10).optional().describe("Trade codes or names"),
    requireValidCertificates: z.boolean().optional().describe("Default true: mandatory certificates valid until `to` (or `from`)"),
  }),
  handler: async (ctx, input) => {
    const trades = await tradeIds(ctx, input.trades)
    if (input.trades?.length && !trades?.length) return { workers: [], note: "No trade matches the given names." }
    const list = await listAvailableWorkers(ctx, {
      from: input.from,
      to: input.to,
      trades,
      ...(input.requireValidCertificates === false ? {} : { requireValidCertsOn: input.to ?? input.from }),
    })
    return {
      count: list.length,
      workers: list.map((w) => ({
        name: w.fullName,
        trades: w.matchingTrades.map((t) => `${t.nameEn} (${t.level})`),
        nationality: w.nationality,
        languages: w.languages,
        driver: w.driverLicenseCategories.length > 0,
        certificates: w.requiredCertStatus,
        link: `/app/staffing/workers/${w.id}`,
      })),
    }
  },
})

export const staffingListProjectsTool = defineAiTool({
  id: "staffing.list_projects",
  description: "Lists projects (client, site, dates, status, number of workers on site today). Optional status filter.",
  permission: StaffingPermissions.projectRead,
  input: z.object({ status: z.enum(PROJECT_STATUSES).optional() }),
  handler: async (ctx, input) => {
    const db = readerOf(ctx)
    const today = todayIso()
    const rows = (await db.query("staffing_projects").take(500)).filter((p) => !input.status || p.status === input.status).sort((a, b) => b.startDate.localeCompare(a.startDate))
    return Promise.all(
      rows.map(async (p) => {
        const client = await db.get("staffing_clients", p.clientId)
        const team = await db
          .query("staffing_assignments")
          .withIndex("by_project", (q) => q.eq("projectId", p._id))
          .collect()
        const onSite = new Set(team.filter((a) => (a.status === "active" || a.status === "confirmed") && a.startDate <= today && (!a.endDate || a.endDate >= today)).map((a) => a.workerId))
        return { code: p.code, name: p.name, client: client?.name ?? null, country: p.country, city: p.city, from: p.startDate, to: p.endDate ?? null, status: p.status, workersToday: onSite.size, link: `/app/staffing/projects/${p._id}` }
      }),
    )
  },
})

/** All staffing base tools, for an agent's `tools`. */
export const staffingTools = [staffingListWorkersTool, staffingGetWorkerTool, staffingFindAvailableWorkersTool, staffingListProjectsTool] as const
