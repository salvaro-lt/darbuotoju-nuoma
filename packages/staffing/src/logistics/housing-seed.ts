// Demo data for the housing pool (DIG-110), on top of `staffing:_seedDemo`:
//   npx convex run logistics:_seedHousing            (skips when pool flats exist)
//   npx convex run logistics:_seedHousing '{"reset":true}'   (wipes stays, logs, pool flats, fleet vehicles first)
// Refuses when APP_ENV is production or unset. Rotterdam region: 6 flats
// (Schiedam, Vlaardingen, Dordrecht, Charlois, Spijkenisse, Maassluis), two
// badly under-occupied (1 person in a 5-bed flat, 2 in another 5-bed flat),
// workers of several projects sharing a flat, 3 own + 2 rented vehicles with
// fuel/km logs, and 3 Filipino welders arriving in 5 days without a bed.
// Creates two NL clients, four NL projects and 22 fictional workers once
// (looked up by code / name on later runs).
import { internalMutationGeneric } from "convex/server"
import { v } from "convex/values"
import { addDays, addMonths, todayIso, type TradeLevel } from "../pure"
import { workerSearchText, writerOf, type ClientId, type ProjectId, type TradeId, type WorkerId } from "../shared"
import type { LogisticsDataModel } from "./plan"

type Nat = "PH" | "UA" | "LT" | "PL"
const HOME: Record<Nat, string> = { PH: "Cebu", UA: "Mykolaiv", LT: "Klaipėda", PL: "Szczecin" }
// [first, last, nationality, languages, trade, level, licence]
const PEOPLE: [string, string, Nat, string[], string, TradeLevel, string[]][] = [
  ["Gediminas", "Pavyzdėnas", "LT", ["lt", "ru", "en"], "FOREMAN", "foreman", ["B", "C"]],
  ["Arūnas", "Bandomaitis", "LT", ["lt", "ru"], "WELD-MAG", "senior", []],
  ["Žydrūnas", "Testavičius", "LT", ["lt", "ru", "en"], "SHIP-FIT", "skilled", ["B"]],
  ["Egidijus", "Pavyzdinis", "LT", ["lt", "ru"], "PIPE-FIT", "skilled", []],
  ["Vitalii", "Probnyi", "UA", ["uk"], "GRINDER", "skilled", []],
  ["Bohdan", "Testovyi", "UA", ["uk", "ru"], "STEEL-ERECT", "senior", ["B", "C"]],
  ["Taras", "Prykladnyi", "UA", ["uk", "ru"], "WELD-MMA", "skilled", []],
  ["Yurii", "Zrazkovyi", "UA", ["uk", "ru"], "WELD-MMA", "skilled", []],
  ["Oleh", "Demonstratsiinyi", "UA", ["uk", "ru"], "PIPE-FIT", "senior", ["B"]],
  ["Roman", "Testiuk", "UA", ["uk", "ru"], "RIGGER", "skilled", []],
  ["Jose", "Halimbawa", "PH", ["tl", "en"], "WELD-TIG", "senior", ["B"]],
  ["Mark", "Sampol", "PH", ["tl", "en"], "WELD-TIG", "skilled", []],
  ["Ramon", "Pagsubok", "PH", ["tl", "en"], "PIPE-FIT", "skilled", []],
  ["Angelo", "Huwad", "PH", ["tl", "en"], "WELD-MAG", "skilled", []],
  ["Paweł", "Przykładny", "PL", ["pl", "en"], "SCAFF", "senior", ["B"]],
  ["Tomasz", "Testowy", "PL", ["pl", "en"], "SCAFF", "skilled", []],
  ["Jericho", "Modelo", "PH", ["tl", "en"], "SHIP-FIT", "senior", ["B"]],
  ["Paolo", "Subukan", "PH", ["tl", "en"], "WELD-MAG", "skilled", []],
  ["Rizal", "Pagsusuri", "PH", ["tl", "en"], "GRINDER", "skilled", []],
  ["Rodel", "Pansamantala", "PH", ["tl", "en"], "WELD-MAG", "senior", ["B"]],
  ["Arnel", "Halimbawa", "PH", ["tl", "en"], "WELD-MAG", "skilled", []],
  ["Noel", "Pagsusulit", "PH", ["tl", "en"], "SHIP-FIT", "skilled", []],
]

export function defineHousingSeed() {
  return {
    /** Dev only. Housing pool, fleet and logs of the Rotterdam region (see the file header). */
    _seedHousing: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; reason?: string; flats: number; stays: number; vehicles: number; logs: number }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`logistics:_seedHousing refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<LogisticsDataModel>(ctx)
        const none = { flats: 0, stays: 0, vehicles: 0, logs: 0 }
        if (a.reset) {
          for (const r of await db.query("staffing_logistics_stays").collect()) await db.delete("staffing_logistics_stays", r._id)
          for (const r of await db.query("staffing_logistics_vehicleLogs").collect()) await db.delete("staffing_logistics_vehicleLogs", r._id)
          for (const r of await db.query("staffing_logistics_vehicles").collect()) if (!r.projectId) await db.delete("staffing_logistics_vehicles", r._id)
          for (const r of await db.query("staffing_logistics_accommodations").collect()) if (!r.projectId) await db.delete("staffing_logistics_accommodations", r._id)
        } else if ((await db.query("staffing_logistics_accommodations").collect()).some((f) => !f.projectId)) return { seeded: false, reason: "already_seeded", ...none }

        const trades = new Map<string, TradeId>((await db.query("staffing_trades").collect()).map((t) => [t.code, t._id]))
        if (trades.size === 0) return { seeded: false, reason: "run staffing:_seedDemo first", ...none }
        const now = Date.now()
        const T = todayIso()

        // ---- clients and projects (once)
        const client = async (code: string, name: string, city: string): Promise<ClientId> => {
          const cur = await db
            .query("staffing_clients")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
          if (cur) return cur._id
          return db.insert("staffing_clients", {
            name,
            code,
            kind: "client",
            country: "NL",
            vatCode: `NL${code === "VSW" ? "862310457" : "853177920"}B01`,
            address: `${city}, NL (demo)`,
            contacts: [{ name: `${code} projectleider (demo)`, role: "Project manager", email: `pm@${code.toLowerCase()}.example`, phone: "+31 10 000 0000" }],
            defaultRates: [],
            currency: "EUR",
            paymentTermsDays: 30,
            invoicingPeriod: "weekly",
            notes: "Demonstracinis klientas (būstų fondo demo).",
            updatedAt: now,
          })
        }
        const vsw = await client("VSW", "Voorbeeld Scheepswerf B.V.", "Schiedam")
        const sbp = await client("SBP", "Staalbouw Proef B.V.", "Dordrecht")
        const project = async (code: string, clientId: ClientId, p: { name: string; city: string; start: string; end: string; trades: string[] }): Promise<ProjectId> => {
          const cur = await db
            .query("staffing_projects")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
          if (cur) return cur._id
          return db.insert("staffing_projects", {
            clientId,
            name: p.name,
            code,
            country: "NL",
            city: p.city,
            siteAddress: `${p.city} (demo aikštelė)`,
            startDate: p.start,
            endDate: p.end,
            status: "active",
            rates: p.trades.filter((c) => trades.has(c)).map((c) => ({ tradeId: trades.get(c)!, hourlyRateCents: 4600 })),
            currency: "EUR",
            notes: "Būstų fondo demo projektas.",
            updatedAt: now,
          })
        }
        const P14 = { start: addDays(T, -45), end: addDays(T, 60) }
        const P15 = { start: addDays(T, -20), end: addDays(T, 75) }
        const P02 = { start: addDays(T, -30), end: addDays(T, 30) }
        const P05 = { start: addDays(T, 5), end: addDays(T, 70) }
        const vsw14 = await project("VSW-2026-14", vsw, { name: "Korpuso remontas, dokas 3", city: "Schiedam", ...P14, trades: ["WELD-MAG", "SHIP-FIT", "FOREMAN", "SCAFF", "PIPE-FIT"] })
        const vsw15 = await project("VSW-2026-15", vsw, { name: "Vamzdynai, Europoort terminalas", city: "Rotterdam", ...P15, trades: ["WELD-TIG", "PIPE-FIT", "WELD-MAG"] })
        const sbp02 = await project("SBP-2026-02", sbp, { name: "Tilto sijos", city: "Dordrecht", ...P02, trades: ["STEEL-ERECT", "WELD-MMA", "RIGGER", "WELD-MAG"] })
        const sbp05 = await project("SBP-2026-05", sbp, { name: "Krano bėgių sijos", city: "Vlissingen", ...P05, trades: ["WELD-MAG", "SHIP-FIT"] })

        // ---- workers (once)
        const workers = new Map<string, WorkerId>()
        const existing = await db.query("staffing_workers").collect()
        for (const [i, [firstName, lastName, nationality, languages, trade, level, licence]] of PEOPLE.entries()) {
          const found = existing.find((w) => w.firstName === firstName && w.lastName === lastName)
          if (found) {
            workers.set(firstName, found._id)
            continue
          }
          const w = {
            firstName,
            lastName,
            phone: nationality === "PH" ? `+63 917 ${String(200000 + i * 911).slice(0, 6)}` : `+370 611 ${String(30000 + i * 173).slice(0, 5)}`,
            nationality,
            languages,
            source: "own" as const,
            trades: trades.has(trade) ? [{ tradeId: trades.get(trade)!, level }] : [],
            driverLicenseCategories: licence,
            ...(licence.length ? { driverLicenseExpiresAt: addMonths(T, 18 + i) } : {}),
            clothingSizes: { jacket: ["M", "L", "XL"][i % 3]!, trousers: String(48 + (i % 4) * 2), shoes: String(40 + (i % 6)) },
            status: "active" as const,
            notes: "Būstų fondo demo darbuotojas.",
            homeCountry: nationality,
            homeCity: HOME[nationality],
          }
          workers.set(firstName, await db.insert("staffing_workers", { ...w, searchText: workerSearchText(w), updatedAt: now }))
        }
        const W = (first: string) => workers.get(first)!

        // ---- assignments (once per worker and project)
        const assign = async (projectId: ProjectId, first: string, trade: string, startDate: string, endDate: string, status: "confirmed" | "active", isDriver = false) => {
          const rows = await db
            .query("staffing_assignments")
            .withIndex("by_worker", (q) => q.eq("workerId", W(first)))
            .collect()
          if (rows.some((r) => r.projectId === projectId)) return
          await db.insert("staffing_assignments", { projectId, workerId: W(first), tradeId: trades.get(trade)!, startDate, endDate, status, isDriver, notes: "", createdBy: "seed", updatedAt: now })
        }
        // Schiedam flat: VSW-14 and SBP-02 people together.
        await assign(vsw14, "Gediminas", "FOREMAN", P14.start, P14.end, "active", true)
        await assign(vsw14, "Žydrūnas", "SHIP-FIT", P14.start, P14.end, "active", true)
        await assign(vsw14, "Egidijus", "PIPE-FIT", P14.start, P14.end, "active")
        await assign(sbp02, "Arūnas", "WELD-MAG", P02.start, P02.end, "active")
        // Vlaardingen: one grinder alone in a 5-bed flat.
        await assign(vsw14, "Vitalii", "GRINDER", P14.start, P14.end, "active")
        // Dordrecht house: SBP-02 and VSW-15.
        await assign(sbp02, "Bohdan", "STEEL-ERECT", P02.start, P02.end, "active", true)
        await assign(sbp02, "Taras", "WELD-MMA", P02.start, P02.end, "active")
        await assign(sbp02, "Yurii", "WELD-MMA", P02.start, P02.end, "active")
        await assign(vsw15, "Oleh", "PIPE-FIT", P15.start, P15.end, "active", true)
        await assign(vsw15, "Roman", "PIPE-FIT", P15.start, P15.end, "active")
        // Charlois: Filipino TIG welders on VSW-15.
        for (const f of ["Jose", "Mark", "Ramon", "Angelo"]) await assign(vsw15, f, f === "Ramon" ? "PIPE-FIT" : "WELD-TIG", P15.start, P15.end, "active", f === "Jose")
        // Spijkenisse: two scaffolders in a 5-bed flat.
        for (const f of ["Paweł", "Tomasz"]) await assign(vsw14, f, "SCAFF", P14.start, P14.end, "active", f === "Paweł")
        // Maassluis: Filipino team on VSW-14.
        for (const f of ["Jericho", "Paolo", "Rizal"]) await assign(vsw14, f, f === "Jericho" ? "SHIP-FIT" : "WELD-MAG", P14.start, P14.end, "active", f === "Jericho")
        // Incoming in 5 days, no bed yet: "Paskirstyti atvykstančius".
        for (const f of ["Rodel", "Arnel", "Noel"]) await assign(sbp05, f, f === "Noel" ? "SHIP-FIT" : "WELD-MAG", P05.start, P05.end, "confirmed", f === "Rodel")

        // ---- flats
        const lease = { startDate: addDays(T, -150), endDate: addDays(T, 215) }
        const flat = (r: { name: string; city: string; address: string; beds: number; rooms: number; eur: number; landlord: string; notes?: string; endDate?: string }) =>
          db.insert("staffing_logistics_accommodations", {
            name: r.name,
            city: r.city,
            region: "Rotterdam",
            address: r.address,
            beds: r.beds,
            rooms: r.rooms,
            costCents: r.eur * 100,
            costPeriod: "month",
            startDate: lease.startDate,
            endDate: r.endDate ?? lease.endDate,
            landlord: r.landlord,
            notes: r.notes ?? "",
            updatedAt: now,
          })
        const schiedam = await flat({ name: "Schiedam, Nieuwe Haven", city: "Schiedam", address: "Nieuwe Haven 112, 3117 AB Schiedam (demo)", beds: 6, rooms: 3, eur: 3450, landlord: "Maasstad Housing B.V. (demo)" })
        const vlaardingen = await flat({ name: "Vlaardingen, Westhavenkade", city: "Vlaardingen", address: "Westhavenkade 40, 3131 AG Vlaardingen (demo)", beds: 5, rooms: 3, eur: 2950, landlord: "Flexwonen Zuid (demo)", endDate: addDays(T, 120), notes: "Nuomos sutartis: 1 mėn. įspėjimas." })
        const dordrecht = await flat({ name: "Dordrecht, Voorstraat (namas)", city: "Dordrecht", address: "Voorstraat 215, 3311 ER Dordrecht (demo)", beds: 8, rooms: 4, eur: 4200, landlord: "Maasstad Housing B.V. (demo)" })
        const charlois = await flat({ name: "Rotterdam-Charlois, Wolphaertsbocht", city: "Rotterdam", address: "Wolphaertsbocht 77, 3083 KM Rotterdam (demo)", beds: 4, rooms: 2, eur: 2600, landlord: "HomeFlex Rotterdam (demo)" })
        const spijkenisse = await flat({ name: "Spijkenisse, Hekelingseweg", city: "Spijkenisse", address: "Hekelingseweg 9, 3202 LB Spijkenisse (demo)", beds: 5, rooms: 3, eur: 2700, landlord: "Flexwonen Zuid (demo)" })
        const maassluis = await flat({ name: "Maassluis, Govert van Wijnkade", city: "Maassluis", address: "Govert van Wijnkade 18, 3144 EG Maassluis (demo)", beds: 4, rooms: 2, eur: 2300, landlord: "HomeFlex Rotterdam (demo)" })
        const flats = 6

        // ---- stays (as long as the assignment)
        let stays = 0
        const stay = async (accommodationId: typeof schiedam, first: string, startDate: string, endDate: string) => {
          stays++
          await db.insert("staffing_logistics_stays", { accommodationId, workerId: W(first), startDate, endDate, notes: "", createdBy: "seed", updatedAt: now })
        }
        for (const f of ["Gediminas", "Žydrūnas", "Egidijus"]) await stay(schiedam, f, P14.start, P14.end)
        await stay(schiedam, "Arūnas", P02.start, P02.end)
        await stay(vlaardingen, "Vitalii", P14.start, P14.end)
        for (const f of ["Bohdan", "Taras", "Yurii"]) await stay(dordrecht, f, P02.start, P02.end)
        for (const f of ["Oleh", "Roman"]) await stay(dordrecht, f, P15.start, P15.end)
        for (const f of ["Jose", "Mark", "Ramon", "Angelo"]) await stay(charlois, f, P15.start, P15.end)
        for (const f of ["Paweł", "Tomasz"]) await stay(spijkenisse, f, P14.start, P14.end)
        for (const f of ["Jericho", "Paolo", "Rizal"]) await stay(maassluis, f, P14.start, P14.end)

        // ---- vehicles: 3 own, 2 rented
        const fleetFrom = addDays(T, -150)
        const fleetTo = addDays(T, 215)
        const vehicle = (r: { plate: string; model: string; seats: number; ownership: "owned" | "rented"; costCents: number; costPeriod: "day" | "month"; accommodationId: typeof schiedam; notes: string }) =>
          db.insert("staffing_logistics_vehicles", { ...r, startDate: fleetFrom, endDate: fleetTo, region: "Rotterdam", updatedAt: now })
        const transit = await vehicle({ plate: "VX-412-K", model: "Ford Transit Custom", seats: 6, ownership: "owned", costCents: 78000, costPeriod: "month", accommodationId: schiedam, notes: "Lizingas + draudimas." })
        const t6 = await vehicle({ plate: "VZ-118-P", model: "VW Transporter T6.1", seats: 9, ownership: "owned", costCents: 95000, costPeriod: "month", accommodationId: dordrecht, notes: "Lizingas + draudimas." })
        const vivaro = await vehicle({ plate: "VR-905-D", model: "Opel Vivaro", seats: 8, ownership: "owned", costCents: 69000, costPeriod: "month", accommodationId: charlois, notes: "Nusidėvėjimas + draudimas." })
        const octavia = await vehicle({ plate: "K-771-XB", model: "Škoda Octavia Combi", seats: 5, ownership: "rented", costCents: 4200, costPeriod: "day", accommodationId: vlaardingen, notes: "Nuoma per Sixt (demo), be vairuotojo bute." })
        const proace = await vehicle({ plate: "V-339-GT", model: "Toyota Proace", seats: 6, ownership: "rented", costCents: 145000, costPeriod: "month", accommodationId: maassluis, notes: "Ilgalaikė nuoma (demo)." })

        // ---- fuel / km log: a fill-up every ~9 days for 60 days, one service.
        let logs = 0
        const fleet: [typeof transit, string | null, number, number][] = [
          [transit, "Gediminas", 640, 0.094],
          [t6, "Bohdan", 720, 0.102],
          [vivaro, "Jose", 560, 0.098],
          [octavia, null, 180, 0.068],
          [proace, "Jericho", 610, 0.091],
        ]
        for (const [i, [vehicleId, driver, baseKm, rate]] of fleet.entries()) {
          for (let k = 0; k < 7; k++) {
            const km = baseKm + ((i * 37 + k * 53) % 140)
            const litres = Math.round(km * rate * 10) / 10
            logs++
            await db.insert("staffing_logistics_vehicleLogs", {
              vehicleId,
              date: addDays(T, -2 - k * 9 - i),
              kind: "fuel",
              km,
              litres,
              costCents: Math.round(litres * 189),
              ...(driver ? { driverId: W(driver) } : {}),
              notes: "",
              createdBy: "seed",
            })
          }
        }
        logs++
        await db.insert("staffing_logistics_vehicleLogs", { vehicleId: t6, date: addDays(T, -12), kind: "service", km: 0, litres: 0, costCents: 42000, driverId: W("Bohdan"), notes: "Techninė priežiūra, padangos.", createdBy: "seed" })

        return { seeded: true, flats, stays, vehicles: 5, logs }
      },
    }),
  }
}
