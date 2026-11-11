// Demo team requests on top of `staffing:_seedDemo`:
//   npx convex run teams:_seedDemo            (skips when requests exist)
//   npx convex run teams:_seedDemo '{"reset":true}'
// Refuses when APP_ENV is production or unset. Built for the base demo data:
// one request the free workers cover fully, one with missing certificates,
// people and drivers, one that mostly needs a subcontractor.
import { internalMutationGeneric } from "convex/server"
import { v } from "convex/values"
import { addDays, todayIso, type TradeLevel } from "../pure"
import { writerOf, type DataModelOf } from "../shared"
import type { staffingTables } from "../tables"
import type { teamsTables } from "./tables"

type DM = DataModelOf<typeof staffingTables & typeof teamsTables>

interface SeedLine {
  trade: string
  count: number
  drivers: number
  certs: string[]
  minLevel?: TradeLevel
}

export function defineTeamsSeed() {
  return {
    /** Dev only. Three open team requests for the staffing demo data. */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; requests: number; note?: string }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`teams:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<DM>(ctx)
        if (a.reset) for (const r of await db.query("staffing_teams_requests").collect()) await db.delete("staffing_teams_requests", r._id)
        else if (await db.query("staffing_teams_requests").first()) return { seeded: false, requests: 0 }

        const trades = new Map((await db.query("staffing_trades").collect()).map((t) => [t.code, t._id]))
        const certs = new Map((await db.query("staffing_certificateTypes").collect()).map((c) => [c.name, c._id]))
        const clients = new Map((await db.query("staffing_clients").collect()).map((c) => [c.code, c]))
        const projects = new Map((await db.query("staffing_projects").collect()).map((p) => [p.code, p]))
        if (!trades.size || !clients.has("NDS")) return { seeded: false, requests: 0, note: "Run staffing:_seedDemo first." }

        const today = todayIso()
        const lines = (ls: SeedLine[]) =>
          ls.flatMap((l) => {
            const tradeId = trades.get(l.trade)
            if (!tradeId) return []
            return [{ tradeId, count: l.count, drivers: l.drivers, ...(l.minLevel ? { minLevel: l.minLevel } : {}), certificateTypeIds: l.certs.flatMap((n) => (certs.has(n) ? [certs.get(n)!] : [])) }]
          })
        const weld = "Suvirintojo sertifikatas EN ISO 9606-1"
        const now = Date.now()
        const base = { languages: ["en"], status: "open" as const, assignmentIds: [], createdBy: "seed", updatedAt: now }
        let n = 0

        // 1. Fully coverable: follow-up blocks for the shipyard the current team works for.
        const nds = clients.get("NDS")!
        await db.insert("staffing_teams_requests", {
          ...base,
          clientId: nds._id,
          projectName: "Korpuso blokai B19–B24",
          country: nds.country,
          site: "Bergen",
          startDate: addDays(today, 25),
          endDate: addDays(today, 46),
          lines: lines([
            { trade: "WELD-MAG", count: 3, drivers: 1, certs: [weld] },
            { trade: "SHIP-FIT", count: 1, drivers: 0, certs: [] },
          ]),
          notes: "Klientas prašo tos pačios komandos kaip B12–B18. Bent vienas komandoje kalba angliškai.",
        })
        n++

        // 2. Gaps: the Danish wind-foundation project (existing draft project).
        const fst = clients.get("FST")
        const p3 = projects.get("FST-2026-11")
        if (fst) {
          await db.insert("staffing_teams_requests", {
            ...base,
            clientId: fst._id,
            ...(p3 ? { projectId: p3._id } : { projectName: "Vėjo jėgainių pamatų karkasai" }),
            country: fst.country,
            site: "Esbjerg",
            startDate: p3?.startDate ?? addDays(today, 18),
            endDate: p3?.endDate ?? addDays(today, 74),
            lines: lines([
              { trade: "WELD-TIG", count: 3, drivers: 2, certs: [weld], minLevel: "skilled" },
              { trade: "PIPE-FIT", count: 2, drivers: 0, certs: ["Karštieji darbai"] },
              { trade: "GRINDER", count: 1, drivers: 1, certs: [] },
            ]),
            notes: "Reikia 2 automobilių: vairuotojai tarp suvirintojų ir šlifuotojas. Karštųjų darbų pažymėjimas privalomas visiems vamzdynininkams.",
          })
          n++
        }

        // 3. Mostly a subcontractor job: expansion of the German warehouse.
        const bst = clients.get("BST")
        const p2 = projects.get("BST-2026-03")
        if (bst) {
          await db.insert("staffing_teams_requests", {
            ...base,
            clientId: bst._id,
            ...(p2 ? { projectId: p2._id } : { projectName: "Sandėlio plėtra" }),
            country: bst.country,
            site: "Hamburg",
            startDate: addDays(today, 10),
            endDate: addDays(today, 66),
            languages: ["de", "en"],
            lines: lines([
              { trade: "STEEL-ERECT", count: 2, drivers: 1, certs: ["Darbas aukštyje"] },
              { trade: "SCAFF", count: 2, drivers: 0, certs: ["Darbas aukštyje"] },
            ]),
            notes: "II etapas: stogo konstrukcijos. Pastolius statyti nuo 2 savaitės.",
          })
          n++
        }
        return { seeded: true, requests: n }
      },
    }),
  }
}
