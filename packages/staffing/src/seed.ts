// Demo data for local development and demos: `npx convex run staffing:_seedDemo`
// (add `'{"reset":true}'` to wipe the staffing tables first). Refuses when
// APP_ENV is production or unset. All names are fictional.
import { internalMutationGeneric } from "convex/server"
import { v } from "convex/values"
import { addDays, addMonths, todayIso, type AssignmentStatus, type TradeLevel } from "./pure"
import { workerSearchText, writerOf, type CertificateTypeId, type ClientId, type TradeId, type WorkerId } from "./shared"
import type { StaffingTableName } from "./tables"

const TRADES: [code: string, lt: string, en: string, rateEur: number][] = [
  ["WELD-MAG", "Suvirintojas MAG (135/136)", "MAG welder (135/136)", 44],
  ["WELD-TIG", "Suvirintojas TIG (141)", "TIG welder (141)", 47],
  ["WELD-MMA", "Suvirintojas MMA (111)", "MMA welder (111)", 43],
  ["WELD-ALU", "Aliuminio suvirintojas", "Aluminium welder", 49],
  ["SHIP-FIT", "Laivų korpusų montuotojas", "Ship hull fitter", 42],
  ["PIPE-FIT", "Vamzdynų montuotojas", "Pipe fitter", 43],
  ["STEEL-ERECT", "Metalo konstrukcijų montuotojas", "Steel erector", 40],
  ["FITTER", "Šaltkalvis-montuotojas", "Mechanical fitter", 39],
  ["GRINDER", "Šlifuotojas", "Grinder", 34],
  ["BLAST-PAINT", "Smėliasrovininkas-dažytojas", "Blaster and painter", 36],
  ["ELEC", "Laivų elektrikas", "Marine electrician", 45],
  ["RIGGER", "Takelažininkas", "Rigger", 38],
  ["CRANE", "Krano operatorius", "Crane operator", 41],
  ["SCAFF", "Pastolių montuotojas", "Scaffolder", 35],
  ["FOREMAN", "Brigadininkas", "Foreman", 52],
]

const CERT_TYPES: [name: string, en: string, mandatory: boolean, months: number | undefined][] = [
  ["Pasas", "Passport", true, 120],
  ["A1 pažyma", "A1 certificate", true, 24],
  ["Saugos instruktažas", "Safety induction", true, 12],
  ["Suvirintojo sertifikatas EN ISO 9606-1", "Welder certificate EN ISO 9606-1", false, 24],
  ["Suvirintojo sertifikatas EN ISO 9606-2 (aliuminis)", "Welder certificate EN ISO 9606-2 (aluminium)", false, 24],
  ["Darbo leidimas", "Work permit", false, 12],
  ["Medicininė pažyma", "Medical certificate", false, 24],
  ["Darbas aukštyje", "Working at height", false, 36],
  ["Karštieji darbai", "Hot work permit training", false, 60],
  ["VCA / SCC", "VCA / SCC safety", false, 120],
  ["Krano operatoriaus pažymėjimas", "Crane operator licence", false, 60],
  ["Pirmoji pagalba", "First aid", false, 36],
]

// Clearly fictional people: surnames built from "example", "test", "sample".
const WORKERS: [first: string, last: string, nat: string, langs: string[], trades: [string, TradeLevel][], licence: string[]][] = [
  ["Jonas", "Pavyzdys", "LT", ["lt", "ru", "en"], [["WELD-MAG", "senior"], ["SHIP-FIT", "skilled"]], ["B"]],
  ["Petras", "Bandomasis", "LT", ["lt", "ru"], [["WELD-MAG", "skilled"]], ["B", "C"]],
  ["Antanas", "Testinis", "LT", ["lt", "en"], [["FOREMAN", "foreman"], ["WELD-TIG", "senior"]], ["B"]],
  ["Mindaugas", "Pavyzdėlis", "LT", ["lt", "ru"], [["PIPE-FIT", "senior"]], ["B"]],
  ["Darius", "Demonstras", "LT", ["lt"], [["GRINDER", "skilled"], ["BLAST-PAINT", "trainee"]], []],
  ["Tomas", "Fiktyvus", "LT", ["lt", "en"], [["WELD-TIG", "skilled"], ["WELD-ALU", "skilled"]], ["B"]],
  ["Vytautas", "Bandinys", "LT", ["lt", "ru", "pl"], [["STEEL-ERECT", "senior"], ["RIGGER", "skilled"]], ["B", "C", "CE"]],
  ["Saulius", "Mėginys", "LT", ["lt", "ru"], [["ELEC", "senior"]], ["B"]],
  ["Rimas", "Pavyzdinskas", "LT", ["lt"], [["WELD-MMA", "skilled"]], []],
  ["Andrius", "Testauskas", "LT", ["lt", "en", "ru"], [["CRANE", "skilled"], ["RIGGER", "skilled"]], ["B", "C"]],
  ["Oleksandr", "Testenko", "UA", ["uk", "ru"], [["WELD-MAG", "senior"]], ["B"]],
  ["Andrii", "Prykladenko", "UA", ["uk", "ru", "pl"], [["SHIP-FIT", "senior"], ["FOREMAN", "skilled"]], ["B"]],
  ["Serhii", "Zrazkovych", "UA", ["uk", "ru"], [["WELD-MAG", "skilled"], ["WELD-MMA", "skilled"]], []],
  ["Dmytro", "Demchenko-Test", "UA", ["uk"], [["GRINDER", "skilled"]], []],
  ["Mykola", "Prykladiuk", "UA", ["uk", "ru"], [["PIPE-FIT", "skilled"], ["WELD-TIG", "trainee"]], ["B"]],
  ["Ivan", "Testovych", "UA", ["uk", "ru", "en"], [["STEEL-ERECT", "skilled"]], ["B", "C"]],
  ["Vasyl", "Zrazok", "UA", ["uk", "ru"], [["BLAST-PAINT", "senior"]], []],
  ["Piotr", "Przykładowski", "PL", ["pl", "en"], [["WELD-TIG", "senior"], ["PIPE-FIT", "skilled"]], ["B"]],
  ["Marek", "Testowski", "PL", ["pl", "ru"], [["SCAFF", "senior"]], ["B"]],
  ["Krzysztof", "Próbny", "PL", ["pl"], [["SHIP-FIT", "skilled"]], []],
  ["Jānis", "Paraugs", "LV", ["lv", "ru", "en"], [["WELD-MAG", "skilled"], ["GRINDER", "skilled"]], ["B"]],
  ["Andris", "Testiņš", "LV", ["lv", "ru"], [["FITTER", "senior"]], ["B", "C"]],
  ["Giorgi", "Nimushi", "GE", ["ka", "ru"], [["WELD-MMA", "senior"]], []],
  ["Laurynas", "Pavyzdukas", "LT", ["lt", "en"], [["WELD-ALU", "senior"]], ["B"]],
  ["Kęstutis", "Bandomis", "LT", ["lt", "ru"], [["SCAFF", "skilled"], ["STEEL-ERECT", "trainee"]], ["B"]],
]

// Workers 18..22 come from the demo subcontractor; 23 and 24 are inactive.
const SUBCONTRACTED = new Set([17, 18, 19, 20, 21])
const INACTIVE = new Set([23])

const CLIENTS = [
  { name: "Nordhavn Demo Shipyard AS", code: "NDS", country: "NO", kind: "client" as const, period: "biweekly" as const, terms: 30, city: "Bergen" },
  { name: "Beispiel Stahlbau GmbH", code: "BST", country: "DE", kind: "client" as const, period: "monthly" as const, terms: 45, city: "Hamburg" },
  { name: "Fiktiv Stålbyg ApS", code: "FST", country: "DK", kind: "client" as const, period: "weekly" as const, terms: 14, city: "Esbjerg" },
  { name: "Esimerkki Telakka Oy", code: "ETO", country: "FI", kind: "client" as const, period: "monthly" as const, terms: 30, city: "Turku" },
  { name: "UAB Pavyzdinis rangovas", code: "PRG", country: "LT", kind: "subcontractor" as const, period: "monthly" as const, terms: 30, city: "Klaipėda" },
]

const TABLES: StaffingTableName[] = ["staffing_assignments", "staffing_workerCertificates", "staffing_projects", "staffing_workers", "staffing_clients", "staffing_certificateTypes", "staffing_trades"]

export function defineSeed() {
  return {
    /** Dev only. Fills the staffing tables with fictional demo data (skips when workers exist, unless `reset`). */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; workers: number; projects: number; assignments: number; certificates: number }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`staffing:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf(ctx)
        if (a.reset) {
          for (const t of TABLES) for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
        } else if (await db.query("staffing_workers").first()) {
          return { seeded: false, workers: 0, projects: 0, assignments: 0, certificates: 0 }
        }
        const now = Date.now()
        const today = todayIso()

        const trade = new Map<string, TradeId>()
        for (const [i, [code, nameLt, nameEn]] of TRADES.entries()) trade.set(code, await db.insert("staffing_trades", { code, nameLt, nameEn, position: i + 1 }))
        const rate = (code: string) => TRADES.find((t) => t[0] === code)![3] * 100

        const cert: CertificateTypeId[] = []
        for (const [i, [name, nameEn, mandatory, months]] of CERT_TYPES.entries())
          cert.push(await db.insert("staffing_certificateTypes", { name, nameEn, appliesTo: "worker", mandatory, ...(months ? { defaultValidityMonths: months } : {}), position: i + 1 }))
        const [passport, a1, induction, weld1, weld2, permit, medical, height, hotWork] = cert as [CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId, CertificateTypeId]

        const clients: ClientId[] = []
        for (const c of CLIENTS)
          clients.push(
            await db.insert("staffing_clients", {
              name: c.name,
              code: c.code,
              kind: c.kind,
              country: c.country,
              vatCode: `${c.country}${String(100000000 + clients.length * 7919).slice(0, 9)}`,
              address: `${c.city}, ${c.country} (demo)`,
              contacts: [{ name: `${c.code} projektų vadovas (demo)`, role: "Project manager", email: `pm@${c.code.toLowerCase()}.example`, phone: "+00 000 000" }],
              defaultRates: c.kind === "subcontractor" ? [] : TRADES.map(([code]) => ({ tradeId: trade.get(code)!, hourlyRateCents: rate(code) })),
              currency: "EUR",
              paymentTermsDays: c.terms,
              invoicingPeriod: c.period,
              notes: "Demonstracinis klientas.",
              updatedAt: now,
            }),
          )
        const subcontractor = clients[4]!

        const workers: WorkerId[] = []
        let certificates = 0
        for (const [i, [firstName, lastName, nationality, languages, trades, licence]] of WORKERS.entries()) {
          const source = SUBCONTRACTED.has(i) ? ("subcontractor" as const) : ("own" as const)
          const w = {
            firstName,
            lastName,
            phone: `+370 600 ${String(10000 + i * 137).slice(0, 5)}`,
            ...(i % 3 === 0 ? { email: `${firstName.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.demo${i}@example.com` } : {}),
            nationality,
            languages,
            source,
            ...(source === "subcontractor" ? { subcontractorClientId: subcontractor } : {}),
            trades: trades.map(([code, level]) => ({ tradeId: trade.get(code)!, level })),
            driverLicenseCategories: licence,
            ...(licence.length ? { driverLicenseExpiresAt: addMonths(today, 12 + i * 3) } : {}),
            clothingSizes: { jacket: ["M", "L", "XL", "XXL"][i % 4]!, trousers: String(48 + (i % 5) * 2), shoes: String(40 + (i % 7)) },
            status: INACTIVE.has(i) ? ("inactive" as const) : ("active" as const),
            notes: i === 2 ? "Patikimas brigadininkas, kalba angliškai su klientu." : "",
            homeCountry: nationality,
            homeCity: { LT: "Klaipėda", UA: "Lviv", PL: "Gdańsk", LV: "Liepāja", GE: "Batumi" }[nationality] ?? "",
          }
          const id = await db.insert("staffing_workers", { ...w, searchText: workerSearchText(w), updatedAt: now })
          workers.push(id)

          // Certificates: most valid; a few expire within 30 or 60 days, one expired, one missing A1.
          const add = async (typeId: CertificateTypeId, expiresAt: string, number?: string) => {
            certificates++
            await db.insert("staffing_workerCertificates", { workerId: id, certificateTypeId: typeId, ...(number ? { number } : {}), issuedAt: addMonths(expiresAt, -24), expiresAt, updatedAt: now })
          }
          await add(passport, addMonths(today, 30 + i * 2), `P${1000000 + i}`)
          if (i !== 12) await add(a1, i % 6 === 1 ? addDays(today, 12 + i) : i % 6 === 4 ? addDays(today, 40 + i) : addMonths(today, 8 + (i % 10)), `A1-${2026}${i}`)
          await add(induction, i === 6 ? addDays(today, -5) : i % 5 === 2 ? addDays(today, 20) : addMonths(today, 4 + (i % 7)))
          if (trades.some(([c]) => c.startsWith("WELD"))) await add(weld1, i % 4 === 0 ? addDays(today, 50) : addMonths(today, 6 + (i % 12)), `ISO9606-1-${i}`)
          if (trades.some(([c]) => c === "WELD-ALU")) await add(weld2, addMonths(today, 10))
          if (nationality === "UA" || nationality === "GE") await add(permit, i === 13 ? addDays(today, 25) : addMonths(today, 5 + (i % 6)), `WP-${i}`)
          if (i % 2 === 0) await add(medical, addMonths(today, 9 + (i % 9)))
          if (trades.some(([c]) => ["STEEL-ERECT", "SCAFF", "RIGGER"].includes(c))) await add(height, i === 9 ? addDays(today, 33) : addMonths(today, 14))
          if (trades.some(([c]) => c.startsWith("WELD") || c === "GRINDER")) await add(hotWork, addMonths(today, 18 + i))
        }

        const project = async (clientIx: number, p: { name: string; code: string; city: string; start: string; end?: string; status: "draft" | "active" | "finished"; trades: string[]; notes: string }) =>
          db.insert("staffing_projects", {
            clientId: clients[clientIx]!,
            name: p.name,
            code: p.code,
            country: CLIENTS[clientIx]!.country,
            city: p.city,
            siteAddress: `${p.city} (demo aikštelė)`,
            startDate: p.start,
            ...(p.end ? { endDate: p.end } : {}),
            status: p.status,
            rates: p.trades.map((code) => ({ tradeId: trade.get(code)!, hourlyRateCents: rate(code) + 300 })),
            currency: "EUR",
            notes: p.notes,
            updatedAt: now,
          })
        const p1Start = addDays(today, -35)
        const p1End = addDays(today, 21)
        const p1 = await project(0, { name: "Korpuso blokai B12–B18", code: "NDS-2026-07", city: "Bergen", start: p1Start, end: p1End, status: "active", trades: ["WELD-MAG", "SHIP-FIT", "FOREMAN"], notes: "8 savaičių projektas, korpuso blokų suvirinimas." })
        const p2Start = addDays(today, -120)
        const p2 = await project(1, { name: "Sandėlio metalo konstrukcijos", code: "BST-2026-03", city: "Hamburg", start: p2Start, status: "active", trades: ["STEEL-ERECT", "WELD-MMA", "CRANE"], notes: "Tęstinis projektas, komandos dydis keičiasi pagal kliento poreikį." })
        const p3Start = addDays(today, 18)
        const p3 = await project(2, { name: "Vėjo jėgainių pamatų karkasai", code: "FST-2026-11", city: "Esbjerg", start: p3Start, end: addDays(p3Start, 56), status: "draft", trades: ["WELD-TIG", "PIPE-FIT"], notes: "Laukiama kliento patvirtinimo." })

        let assignments = 0
        const assign = async (projectId: typeof p1, wi: number, code: string, startDate: string, endDate: string | undefined, status: AssignmentStatus, isDriver = false) => {
          assignments++
          await db.insert("staffing_assignments", { projectId, workerId: workers[wi]!, tradeId: trade.get(code)!, startDate, ...(endDate ? { endDate } : {}), status, isDriver, notes: "", createdBy: "seed", updatedAt: now })
        }
        // Project 1: active team of 8 in Norway.
        await assign(p1, 2, "FOREMAN", p1Start, p1End, "active")
        await assign(p1, 0, "WELD-MAG", p1Start, p1End, "active", true)
        await assign(p1, 1, "WELD-MAG", p1Start, p1End, "active", true)
        await assign(p1, 10, "WELD-MAG", p1Start, p1End, "active")
        await assign(p1, 11, "SHIP-FIT", p1Start, p1End, "active")
        await assign(p1, 12, "WELD-MAG", addDays(p1Start, 14), p1End, "active")
        await assign(p1, 19, "SHIP-FIT", p1Start, p1End, "active")
        await assign(p1, 20, "WELD-MAG", addDays(today, 3), p1End, "confirmed")
        // Project 2: ongoing in Germany; two ended, five active.
        await assign(p2, 6, "STEEL-ERECT", p2Start, undefined, "active", true)
        await assign(p2, 9, "CRANE", p2Start, undefined, "active")
        await assign(p2, 15, "STEEL-ERECT", addDays(p2Start, 30), undefined, "active", true)
        await assign(p2, 22, "WELD-MMA", addDays(p2Start, 10), undefined, "active")
        await assign(p2, 18, "SCAFF", addDays(p2Start, 45), undefined, "active")
        await assign(p2, 8, "WELD-MMA", p2Start, addDays(p2Start, 60), "ended")
        await assign(p2, 24, "SCAFF", p2Start, addDays(p2Start, 40), "ended")
        // Project 3: proposed team for Denmark, starting after project 1 ends for some.
        await assign(p3, 5, "WELD-TIG", p3Start, addDays(p3Start, 56), "proposed", true)
        await assign(p3, 17, "WELD-TIG", p3Start, addDays(p3Start, 56), "proposed")
        await assign(p3, 3, "PIPE-FIT", p3Start, addDays(p3Start, 56), "proposed")
        await assign(p3, 14, "PIPE-FIT", p3Start, addDays(p3Start, 56), "proposed")
        await assign(p3, 2, "WELD-TIG", addDays(p1End, 3), addDays(p3Start, 56), "proposed")

        return { seeded: true, workers: workers.length, projects: 3, assignments, certificates }
      },
    }),
  }
}
