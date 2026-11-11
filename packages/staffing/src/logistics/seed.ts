// Demo data for the logistics area, on top of `staffing:_seedDemo`:
//   npx convex run logistics:_seedDemo            (skips when accommodations exist)
//   npx convex run logistics:_seedDemo '{"reset":true}'
// Refuses when APP_ENV is production or unset. Deliberate problems for the demo:
// one car without a driver, 1 bed short from next week, 2 travel legs not
// booked, a worker without clothing sizes, a paid empty bed, a team change
// since the coordinator's last acknowledgment.
import { internalMutationGeneric } from "convex/server"
import { v, type GenericId } from "convex/values"
import { addDays, fullName, isBlockingAssignment, todayIso } from "../pure"
import { writerOf, type ProjectId, type WorkerId } from "../shared"
import type { LogisticsDataModel } from "./plan"
import { planSnapshot, type TravelMode } from "./pure"
import type { LogisticsTableName } from "./tables"

const TABLES: LogisticsTableName[] = [
  "staffing_logistics_stays",
  "staffing_logistics_vehicleLogs",
  "staffing_logistics_allocations",
  "staffing_logistics_travelLegs",
  "staffing_logistics_accommodations",
  "staffing_logistics_vehicles",
  "staffing_logistics_settings",
  "staffing_logistics_notifications",
]

const HOME_TRIP: Record<string, { from: string; mode: TravelMode; cents: number }> = {
  LT: { from: "Klaipėda", mode: "flight", cents: 18900 },
  UA: { from: "Lviv", mode: "bus", cents: 12500 },
  PL: { from: "Gdańsk", mode: "flight", cents: 15400 },
  LV: { from: "Rīga", mode: "flight", cents: 21900 },
  GE: { from: "Batumi", mode: "flight", cents: 32000 },
}

export function defineLogisticsSeed() {
  return {
    /** Dev only. Accommodation, vehicles, travel legs and allocations for the demo projects NDS-2026-07 and BST-2026-03. */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; reason?: string; accommodations: number; vehicles: number; travelLegs: number }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`logistics:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<LogisticsDataModel>(ctx)
        const none = { accommodations: 0, vehicles: 0, travelLegs: 0 }
        if (a.reset) {
          for (const t of TABLES) for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
        } else if (await db.query("staffing_logistics_accommodations").first()) return { seeded: false, reason: "already_seeded", ...none }

        const byCode = async (code: string) =>
          db
            .query("staffing_projects")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
        const p1 = await byCode("NDS-2026-07")
        const p2 = await byCode("BST-2026-03")
        if (!p1 || !p2 || !p1.endDate) return { seeded: false, reason: "run staffing:_seedDemo first", ...none }

        const workers = await db.query("staffing_workers").collect()
        const w = (lastName: string) => {
          const found = workers.find((x) => x.lastName === lastName)
          if (!found) throw new Error(`demo worker ${lastName} missing: run staffing:_seedDemo '{"reset":true}'`)
          return found
        }
        const now = Date.now()
        const today = todayIso()
        const counts = { accommodations: 0, vehicles: 0, travelLegs: 0 }

        const acc = async (projectId: ProjectId, r: { name: string; address: string; beds: number; costCents: number; costPeriod: "night" | "month"; startDate: string; endDate: string; notes?: string }) => {
          counts.accommodations++
          return db.insert("staffing_logistics_accommodations", { projectId, notes: "", ...r, updatedAt: now })
        }
        const veh = async (projectId: ProjectId, r: { plate: string; model: string; seats: number; ownership: "rented" | "owned"; costCents: number; costPeriod: "day" | "month"; startDate: string; endDate: string; notes?: string }) => {
          counts.vehicles++
          return db.insert("staffing_logistics_vehicles", { projectId, notes: "", ...r, updatedAt: now })
        }
        const place = (projectId: ProjectId, workerId: WorkerId, r: { accommodationId: GenericId<"staffing_logistics_accommodations">; vehicleId: GenericId<"staffing_logistics_vehicles">; driver?: boolean }) =>
          db.insert("staffing_logistics_allocations", { projectId, workerId, accommodationId: r.accommodationId, vehicleId: r.vehicleId, driver: r.driver ?? false, updatedAt: now })
        const leg = async (projectId: ProjectId, worker: (typeof workers)[number], direction: "arrival" | "departure", site: string, date: string, booked: boolean) => {
          counts.travelLegs++
          const trip = HOME_TRIP[worker.nationality] ?? HOME_TRIP.LT!
          await db.insert("staffing_logistics_travelLegs", {
            projectId,
            workerId: worker._id,
            direction,
            fromCity: direction === "arrival" ? trip.from : site,
            toCity: direction === "arrival" ? site : trip.from,
            date,
            mode: trip.mode,
            ticketCostCents: trip.cents,
            booked,
            ...(booked ? { bookingRef: `DEMO-${String(counts.travelLegs).padStart(4, "0")}` } : {}),
            notes: "",
            updatedAt: now,
          })
        }

        // ---- NDS-2026-07, Bergen: 7 beds; Jānis arrives in 3 days → 8 people, 1 bed short.
        const p1Start = p1.startDate
        const p1End = p1.endDate
        const flat = await acc(p1._id, { name: "Laksevåg apartamentai", address: "Laksevågneset 12, Bergen (demo)", beds: 5, costCents: 480000, costPeriod: "month", startDate: p1Start, endDate: p1End })
        const hotel = await acc(p1._id, { name: "Hotel Nygård, 2 kambariai", address: "Nygårdsgaten 5, Bergen (demo)", beds: 2, costCents: 11900, costPeriod: "night", startDate: p1Start, endDate: p1End, notes: "Kaina už 2 kambarius per naktį." })
        const van = await veh(p1._id, { plate: "EB 12345", model: "VW Transporter", seats: 9, ownership: "rented", costCents: 230000, costPeriod: "month", startDate: p1Start, endDate: p1End })
        const [foreman, jonas, petras, oleks, andrii, serhii, krzys, janis] = ["Testinis", "Pavyzdys", "Bandomasis", "Testenko", "Prykladenko", "Zrazkovych", "Próbny", "Paraugs"].map(w)
        for (const x of [foreman!, jonas!, petras!, oleks!, andrii!]) await place(p1._id, x._id, { accommodationId: flat, vehicleId: van, driver: x === jonas })
        for (const x of [serhii!, krzys!]) await place(p1._id, x._id, { accommodationId: hotel, vehicleId: van })
        for (const x of [foreman!, jonas!, petras!, oleks!, andrii!, krzys!]) await leg(p1._id, x, "arrival", "Bergen", addDays(p1Start, -1), true)
        await leg(p1._id, serhii!, "arrival", "Bergen", addDays(p1Start, 13), true)
        await leg(p1._id, janis!, "arrival", "Bergen", addDays(today, 2), false) // not booked yet
        for (const x of [foreman!, jonas!, petras!, oleks!, andrii!, serhii!, krzys!, janis!]) await leg(p1._id, x, "departure", "Bergen", addDays(p1End, 1), x !== oleks) // Oleksandr's ticket home not booked
        // Serhii's sizes are unknown.
        await db.patch("staffing_workers", serhii!._id, { clothingSizes: {}, updatedAt: now })
        // The coordinator acknowledged the plan before Jānis was confirmed → "Planas pasikeitė".
        const p1Team = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", p1._id))
            .collect()
        ).filter((x) => isBlockingAssignment(x) && x.workerId !== janis!._id)
        const snap = planSnapshot(p1Team.map((x) => ({ workerId: x.workerId, name: fullName(workers.find((y) => y._id === x.workerId)!), startDate: x.startDate, endDate: x.endDate ?? null, isDriver: x.isDriver })))
        await db.insert("staffing_logistics_settings", { projectId: p1._id, dailyDigest: true, ackSnapshot: snap, ackAt: now - 2 * 86_400_000, ackBy: "seed", updatedAt: now })

        // ---- BST-2026-03, Hamburg: a house with 6 beds for 5 people (1 empty bed paid), the Škoda has no driver.
        const p2Start = p2.startDate
        const p2Until = addDays(today, 60)
        const house = await acc(p2._id, { name: "Namas Wilhelmsburg", address: "Veringstraße 40, Hamburg (demo)", beds: 6, costCents: 360000, costPeriod: "month", startDate: p2Start, endDate: p2Until, notes: "Nuoma pratęsiama kas 2 mėn." })
        const transit = await veh(p2._id, { plate: "HH DR 412", model: "Ford Transit", seats: 6, ownership: "owned", costCents: 45000, costPeriod: "month", startDate: p2Start, endDate: p2Until, notes: "Įmonės automobilis (lizingas)." })
        const skoda = await veh(p2._id, { plate: "HH AB 908", model: "Škoda Octavia", seats: 5, ownership: "rented", costCents: 3800, costPeriod: "day", startDate: addDays(today, -20), endDate: p2Until })
        const [vytautas, andrius, ivan, giorgi, marek] = ["Bandinys", "Testauskas", "Testovych", "Nimushi", "Testowski"].map(w)
        await place(p2._id, vytautas!._id, { accommodationId: house, vehicleId: transit, driver: true })
        await place(p2._id, andrius!._id, { accommodationId: house, vehicleId: transit })
        await place(p2._id, ivan!._id, { accommodationId: house, vehicleId: transit })
        await place(p2._id, giorgi!._id, { accommodationId: house, vehicleId: skoda })
        await place(p2._id, marek!._id, { accommodationId: house, vehicleId: skoda })
        const p2Rows = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", p2._id))
            .collect()
        ).filter(isBlockingAssignment)
        for (const x of p2Rows) await leg(p2._id, workers.find((y) => y._id === x.workerId)!, "arrival", "Hamburg", addDays(x.startDate, -1), true)
        await db.insert("staffing_logistics_settings", {
          projectId: p2._id,
          dailyDigest: false,
          ackSnapshot: planSnapshot(p2Rows.map((x) => ({ workerId: x.workerId, name: fullName(workers.find((y) => y._id === x.workerId)!), startDate: x.startDate, endDate: x.endDate ?? null, isDriver: x.isDriver }))),
          ackAt: now - 86_400_000,
          ackBy: "seed",
          updatedAt: now,
        })

        return { seeded: true, ...counts }
      },
    }),
  }
}
