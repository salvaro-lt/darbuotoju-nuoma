// Demo data of the "planning" area on top of `staffing:_seedDemo` (and best
// after `teams:_seedDemo`):
//   npx convex run planning:_seedDemo            (skips when already seeded)
//   npx convex run planning:_seedDemo '{"reset":true}'   (re-creates the planning rows)
// Refuses when APP_ENV is production or unset. Idempotent: clients, workers,
// projects and requests are looked up by code / name and only added when
// missing; with `reset` the planning rows (rest periods, capacities, rules,
// feedback) made by the seed are replaced.
//
// The story is the interview's week (19:00): a Rotterdam project ends this
// Friday (9 people: 3 go home to rest, 6 could go on), a Botlek project ends
// next Friday (10 people freed a week later), and two clients need 15 + 10
// people from Monday. All names are fictional ("halimbawa", "pagsubok",
// "pryklad" mean "example" / "test").
import { internalMutationGeneric } from "convex/server"
import { v } from "convex/values"
import { addDays, addMonths, todayIso, type AvailabilityKind, type TradeLevel } from "../pure"
import { workerSearchText, writerOf, type ClientId, type ProjectId, type TradeId, type WorkerId } from "../shared"
import type { PlanningDataModel } from "./operations"
import { mondayOf, nextMonday } from "./pure"
import type { EnglishScope } from "./rules"

const SEED = "seed:planning"

type W = [first: string, last: string, nat: string, langs: string[], trades: [string, TradeLevel][], licence: string[], sub?: string]

const WORKERS: W[] = [
  // Filipinos: English speakers, welders.
  ["Jose", "Halimbawa", "PH", ["tl", "en"], [["WELD-MAG", "senior"]], ["B"]],
  ["Ramon", "Pagsubok", "PH", ["tl", "en"], [["WELD-MAG", "skilled"]], []],
  ["Mark", "Sampol", "PH", ["tl", "en"], [["WELD-MAG", "skilled"]], ["B"]],
  ["Rodel", "Halimbawa", "PH", ["tl", "en"], [["WELD-MAG", "skilled"]], []],
  ["Jun", "Pagsusulit", "PH", ["tl", "en"], [["WELD-MAG", "skilled"]], []],
  ["Arnel", "Modelo", "PH", ["tl", "en"], [["WELD-MAG", "senior"], ["GRINDER", "skilled"]], ["B"]],
  ["Ricky", "Huwaran", "PH", ["tl", "en"], [["SHIP-FIT", "skilled"]], []],
  ["Dennis", "Pagsubok", "PH", ["tl", "en"], [["WELD-MAG", "skilled"]], []],
  // Ukrainians: mostly Ukrainian and Russian only.
  ["Taras", "Prykladnyi", "UA", ["uk", "ru", "en"], [["WELD-MAG", "senior"]], ["B"]],
  ["Bohdan", "Testiuk", "UA", ["uk", "ru"], [["WELD-MAG", "skilled"]], []],
  ["Yurii", "Zrazkov", "UA", ["uk", "ru"], [["SHIP-FIT", "skilled"]], ["B"]],
  ["Oleh", "Demchuk-Test", "UA", ["uk", "ru"], [["WELD-MAG", "skilled"]], []],
  ["Roman", "Probnyi", "UA", ["uk", "ru", "pl"], [["PIPE-FIT", "skilled"]], []],
  ["Viktor", "Shablon", "UA", ["uk", "ru"], [["WELD-MAG", "senior"]], ["B", "C"]],
  ["Pavlo", "Maketenko", "UA", ["uk", "ru"], [["PIPE-FIT", "skilled"]], []],
  ["Ihor", "Testovyi", "UA", ["uk", "ru"], [["WELD-MAG", "skilled"]], ["B"]],
  // Lithuanians.
  ["Gintaras", "Pavyzdėnas", "LT", ["lt", "ru", "en"], [["SHIP-FIT", "senior"], ["FOREMAN", "skilled"]], ["B", "C"]],
  ["Egidijus", "Bandymas", "LT", ["lt", "ru"], [["WELD-MAG", "skilled"]], ["B"]],
  ["Arūnas", "Testas", "LT", ["lt", "en"], [["ELEC", "senior"]], ["B"]],
  ["Marius", "Mėginėlis", "LT", ["lt", "ru"], [["WELD-MAG", "skilled"]], []],
  ["Rolandas", "Pavyzdžiūnas", "LT", ["lt", "ru"], [["ELEC", "skilled"]], ["B"]],
  ["Sigitas", "Mėgintojas", "LT", ["lt", "ru", "en"], [["WELD-MAG", "senior"]], ["B"]],
  ["Valdas", "Bandomėlis", "LT", ["lt", "ru"], [["PIPE-FIT", "skilled"]], ["B"]],
  // Only Romanian: no common language with most teams.
  ["Ion", "Exemplu", "RO", ["ro"], [["WELD-MAG", "skilled"]], []],
  // Registered subcontractor workers.
  ["Kazimieras", "Subrangaitis", "LT", ["lt", "pl", "ru"], [["WELD-MAG", "skilled"]], ["B"], "PMU"],
  ["Wojciech", "Przykładny", "PL", ["pl"], [["WELD-MAG", "skilled"]], [], "PSS"],
]

const CLIENTS = [
  { code: "RDW", name: "Rotterdamse Demo Werf B.V.", country: "NL", city: "Rotterdam", kind: "client" as const },
  { code: "SDO", name: "Schiedam Demo Offshore B.V.", country: "NL", city: "Schiedam", kind: "client" as const },
  { code: "BDI", name: "Botlek Demo Industrie B.V.", country: "NL", city: "Rotterdam-Botlek", kind: "client" as const },
  { code: "PMU", name: "UAB Pavyzdžio montažas", country: "LT", city: "Klaipėda", kind: "subcontractor" as const },
  { code: "PSS", name: "Przykład Spawanie Sp. z o.o.", country: "PL", city: "Gdańsk", kind: "subcontractor" as const },
]

const RATES: Record<string, number> = { "WELD-MAG": 4600, "WELD-TIG": 4900, "SHIP-FIT": 4400, "PIPE-FIT": 4500, ELEC: 4700, FOREMAN: 5400, GRINDER: 3600 }

export function definePlanningSeed() {
  return {
    /** Dev only. Rest periods, subcontractor capacities, client rules, feedback, extra workers and the interview's week. */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; workers: number; availability: number; capacities: number; rules: number; feedback: number; requests: number; note?: string }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`planning:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<PlanningDataModel>(ctx)
        const none = { seeded: false, workers: 0, availability: 0, capacities: 0, rules: 0, feedback: 0, requests: 0 }
        const tradeRows = await db.query("staffing_trades").collect()
        const trades = new Map(tradeRows.map((t) => [t.code, t._id as TradeId]))
        const certTypes = new Map((await db.query("staffing_certificateTypes").collect()).map((c) => [c.name, c._id]))
        if (!trades.has("WELD-MAG") || !certTypes.has("Pasas")) return { ...none, note: "Run staffing:_seedDemo first." }

        const already = await db
          .query("staffing_clients")
          .withIndex("by_code", (q) => q.eq("code", "RDW"))
          .first()
        if (already && !a.reset) return none
        if (a.reset) {
          for (const r of await db.query("staffing_workerAvailability").collect()) if (r.createdBy === SEED) await db.delete("staffing_workerAvailability", r._id)
          for (const r of await db.query("staffing_planning_capacities").collect()) if (r.createdBy === SEED) await db.delete("staffing_planning_capacities", r._id)
          for (const r of await db.query("staffing_planning_clientRules").collect()) if (r.createdBy === SEED) await db.delete("staffing_planning_clientRules", r._id)
          for (const r of await db.query("staffing_planning_feedback").collect()) if (r.createdBy === SEED) await db.delete("staffing_planning_feedback", r._id)
        }

        const now = Date.now()
        const today = todayIso()
        const monday = nextMonday(today)
        const thisFriday = addDays(mondayOf(today), 4)
        const nextFriday = addDays(monday, 4)
        const tradeId = (code: string) => trades.get(code)!

        // ---- clients and subcontractors
        const client = new Map<string, ClientId>()
        for (const c of await db.query("staffing_clients").collect()) client.set(c.code, c._id)
        for (const c of CLIENTS) {
          if (client.has(c.code)) continue
          client.set(
            c.code,
            await db.insert("staffing_clients", {
              name: c.name,
              code: c.code,
              kind: c.kind,
              country: c.country,
              vatCode: c.country === "NL" ? `NL00${c.code.charCodeAt(0)}${c.code.charCodeAt(1)}000B01` : `${c.country}${100000000 + c.code.charCodeAt(0) * 1000}`,
              address: `${c.city}, ${c.country} (demo)`,
              contacts: [{ name: `${c.code} ${c.kind === "client" ? "projectleider" : "vadovas"} (demo)`, role: "Project manager", email: `pm@${c.code.toLowerCase()}.example`, phone: "+00 000 000" }],
              defaultRates: c.kind === "client" ? Object.entries(RATES).flatMap(([code, cents]) => (trades.has(code) ? [{ tradeId: tradeId(code), hourlyRateCents: cents }] : [])) : [],
              currency: "EUR",
              paymentTermsDays: 30,
              invoicingPeriod: c.kind === "client" ? "biweekly" : "monthly",
              notes: c.kind === "client" ? "Demonstracinis klientas (planavimas)." : "Demonstracinis subrangovas (planavimas).",
              updatedAt: now,
            }),
          )
        }

        // ---- workers (looked up by name) with valid documents
        const byName = new Map<string, WorkerId>()
        for (const w of await db.query("staffing_workers").collect()) byName.set(`${w.firstName} ${w.lastName}`, w._id)
        const cert = (name: string) => certTypes.get(name)
        let newWorkers = 0
        for (const [i, [firstName, lastName, nationality, languages, wTrades, licence, sub]] of WORKERS.entries()) {
          const key = `${firstName} ${lastName}`
          if (byName.has(key)) continue
          const w = {
            firstName,
            lastName,
            phone: `+${nationality === "PH" ? "63" : nationality === "UA" ? "380" : nationality === "PL" ? "48" : nationality === "RO" ? "40" : "370"} 600 ${String(20000 + i * 211).slice(0, 5)}`,
            nationality,
            languages,
            source: sub ? ("subcontractor" as const) : ("own" as const),
            ...(sub && client.has(sub) ? { subcontractorClientId: client.get(sub)! } : {}),
            trades: wTrades.filter(([c]) => trades.has(c)).map(([c, level]) => ({ tradeId: tradeId(c), level })),
            driverLicenseCategories: licence,
            ...(licence.length ? { driverLicenseExpiresAt: addMonths(today, 18 + i) } : {}),
            clothingSizes: { jacket: ["M", "L", "XL"][i % 3]!, trousers: String(48 + (i % 4) * 2), shoes: String(41 + (i % 5)) },
            status: "active" as const,
            notes: "",
            homeCountry: nationality,
            homeCity: { PH: "Cebu", UA: "Lviv", LT: "Klaipėda", PL: "Gdańsk", RO: "Constanța" }[nationality] ?? "",
          }
          const id = await db.insert("staffing_workers", { ...w, searchText: workerSearchText(w), updatedAt: now })
          byName.set(key, id)
          newWorkers++
          const add = async (name: string, expiresAt: string, number?: string) => {
            const type = cert(name)
            if (type) await db.insert("staffing_workerCertificates", { workerId: id, certificateTypeId: type, ...(number ? { number } : {}), issuedAt: addMonths(expiresAt, -24), expiresAt, updatedAt: now })
          }
          await add("Pasas", addMonths(today, 40 + i), `P${2000000 + i}`)
          await add("A1 pažyma", addMonths(today, 9 + (i % 6)), `A1-2026-P${i}`)
          await add("Saugos instruktažas", addMonths(today, 6 + (i % 5)))
          if (wTrades.some(([c]) => c.startsWith("WELD"))) {
            await add("Suvirintojo sertifikatas EN ISO 9606-1", addMonths(today, 8 + (i % 10)), `ISO9606-1-P${i}`)
            await add("Karštieji darbai", addMonths(today, 20 + i))
          }
          if (["PH", "UA"].includes(nationality)) await add("Darbo leidimas", addMonths(today, 7 + (i % 6)), `WP-P${i}`)
          if (nationality !== "RO") await add("VCA / SCC", addMonths(today, 30 + i), `VCA-${130000 + i * 37}`)
        }
        const worker = (first: string, last: string) => byName.get(`${first} ${last}`)

        // ---- projects: the one ending this Friday, the one ending next Friday, an older one for history
        const projectByCode = new Map((await db.query("staffing_projects").collect()).map((p) => [p.code, p._id as ProjectId]))
        const project = async (code: string, clientCode: string, p: { name: string; city: string; start: string; end: string; status: "active" | "finished"; trades: string[]; notes: string }, team: [first: string, last: string, trade: string, driver?: boolean][]) => {
          if (projectByCode.has(code)) return
          const c = CLIENTS.find((x) => x.code === clientCode)!
          const id = await db.insert("staffing_projects", {
            clientId: client.get(clientCode)!,
            name: p.name,
            code,
            country: c.country,
            city: p.city,
            siteAddress: `${p.city} (demo aikštelė)`,
            startDate: p.start,
            endDate: p.end,
            status: p.status,
            rates: p.trades.filter((t) => trades.has(t)).map((t) => ({ tradeId: tradeId(t), hourlyRateCents: (RATES[t] ?? 4200) + 200 })),
            currency: "EUR",
            notes: p.notes,
            updatedAt: now,
          })
          projectByCode.set(code, id)
          for (const [first, last, trade, driver] of team) {
            const wid = worker(first, last)
            if (!wid || !trades.has(trade)) continue
            await db.insert("staffing_assignments", {
              projectId: id,
              workerId: wid,
              tradeId: tradeId(trade),
              startDate: p.start,
              endDate: p.end,
              status: p.status === "finished" ? "ended" : "active",
              isDriver: Boolean(driver),
              notes: "",
              createdBy: SEED,
              updatedAt: now,
            })
          }
        }
        await project(
          "RDW-2026-02",
          "RDW",
          { name: "Sekcijų suvirinimas (pavasaris)", city: "Rotterdam", start: addDays(today, -210), end: addDays(today, -155), status: "finished", trades: ["WELD-MAG", "SHIP-FIT"], notes: "Užbaigtas projektas: istorija ir pastabos apie darbuotojus." },
          [
            ["Jose", "Halimbawa", "WELD-MAG", true],
            ["Taras", "Prykladnyi", "WELD-MAG"],
            ["Rodel", "Halimbawa", "WELD-MAG"],
            ["Gintaras", "Pavyzdėnas", "SHIP-FIT", true],
            ["Dennis", "Pagsubok", "WELD-MAG"],
          ],
        )
        await project(
          "RDW-2026-05",
          "RDW",
          { name: "Doko vartų remontas", city: "Rotterdam", start: addDays(thisFriday, -46), end: thisFriday, status: "active", trades: ["WELD-MAG", "SHIP-FIT"], notes: "Baigiasi šį penktadienį: 9 žmonės, 3 važiuoja namo pailsėti, 6 gali tęsti." },
          [
            ["Jose", "Halimbawa", "WELD-MAG", true],
            ["Ramon", "Pagsubok", "WELD-MAG"],
            ["Mark", "Sampol", "WELD-MAG", true],
            ["Rodel", "Halimbawa", "WELD-MAG"],
            ["Taras", "Prykladnyi", "WELD-MAG"],
            ["Bohdan", "Testiuk", "WELD-MAG"],
            ["Yurii", "Zrazkov", "SHIP-FIT"],
            ["Gintaras", "Pavyzdėnas", "SHIP-FIT", true],
            ["Egidijus", "Bandymas", "WELD-MAG"],
          ],
        )
        await project(
          "BDI-2026-09",
          "BDI",
          { name: "Elektrinės remontas (6 sav.)", city: "Rotterdam-Botlek", start: addDays(nextFriday, -39), end: nextFriday, status: "active", trades: ["WELD-MAG", "PIPE-FIT", "ELEC", "SHIP-FIT"], notes: "Šešių savaičių remontas, baigiasi kitą penktadienį: atsilaisvins 10 žmonių." },
          [
            ["Jun", "Pagsusulit", "WELD-MAG"],
            ["Arnel", "Modelo", "WELD-MAG", true],
            ["Ricky", "Huwaran", "SHIP-FIT"],
            ["Oleh", "Demchuk-Test", "WELD-MAG"],
            ["Roman", "Probnyi", "PIPE-FIT"],
            ["Viktor", "Shablon", "WELD-MAG", true],
            ["Pavlo", "Maketenko", "PIPE-FIT"],
            ["Arūnas", "Testas", "ELEC", true],
            ["Marius", "Mėginėlis", "WELD-MAG"],
            ["Rolandas", "Pavyzdžiūnas", "ELEC"],
          ],
        )

        // ---- rotation: rest at home, unavailable, available from
        let availability = 0
        const away = async (first: string, last: string, kind: AvailabilityKind, startDate: string, endDate: string | null, note: string) => {
          const wid = worker(first, last)
          if (!wid) return
          const existing = await db
            .query("staffing_workerAvailability")
            .withIndex("by_worker", (q) => q.eq("workerId", wid).eq("startDate", startDate))
            .first()
          if (existing) return
          await db.insert("staffing_workerAvailability", { workerId: wid, kind, startDate, ...(endDate ? { endDate } : {}), note, createdBy: SEED, updatedAt: now })
          availability++
        }
        const afterThis = addDays(thisFriday, 1)
        await away("Bohdan", "Testiuk", "rest", afterThis, addDays(afterThis, 13), "Namo pailsėti pagal grafiką (2 sav.)")
        await away("Yurii", "Zrazkov", "rest", afterThis, addDays(afterThis, 13), "Namo pailsėti pagal grafiką (2 sav.)")
        await away("Egidijus", "Bandymas", "rest", afterThis, addDays(afterThis, 20), "Namo pailsėti, šeimos šventė (3 sav.)")
        await away("Sigitas", "Mėgintojas", "rest", addDays(today, -13), addDays(monday, -1), "Poilsis po projekto, grįžta pirmadienį")
        await away("Valdas", "Bandomėlis", "rest", addDays(today, -6), addDays(today, 16), "Poilsis namuose")
        await away("Ihor", "Testovyi", "available_from", addDays(monday, 7), null, "Laukia darbo leidimo pratęsimo")
        await away("Viktor", "Shablon", "rest", addDays(nextFriday, 1), addDays(nextFriday, 14), "Po projekto namo 2 sav.")
        // Base demo workers: the Bergen welder wants to go home after his project.
        const p1End = (
          await db
            .query("staffing_projects")
            .withIndex("by_code", (q) => q.eq("code", "NDS-2026-07"))
            .first()
        )?.endDate
        if (p1End) await away("Petras", "Bandomasis", "rest", addDays(p1End, 1), addDays(p1End, 14), "Nori grįžti namo pailsėti po Bergeno projekto")
        await away("Rimas", "Pavyzdinskas", "unavailable", addDays(monday, 14), addDays(monday, 20), "Gydytojo konsultacija, nepasiekiamas savaitę")

        // ---- subcontractor capacity (declared per trade, with validity)
        let capacities = 0
        const capacity = async (code: string, trade: string, count: number, validFrom: string, validTo: string | null, note: string) => {
          const clientId = client.get(code)
          if (!clientId || !trades.has(trade)) return
          const prior = await db
            .query("staffing_planning_capacities")
            .withIndex("by_client", (q) => q.eq("clientId", clientId).eq("tradeId", tradeId(trade)))
            .first()
          if (prior) return
          await db.insert("staffing_planning_capacities", { clientId, tradeId: tradeId(trade), count, validFrom, ...(validTo ? { validTo } : {}), note, createdBy: SEED, updatedAt: now })
          capacities++
        }
        await capacity("PRG", "WELD-MAG", 3, today, addDays(today, 60), "Patvirtino telefonu, gali atvykti per 5 d. d.")
        await capacity("PRG", "PIPE-FIT", 2, today, addDays(today, 60), "")
        await capacity("PMU", "WELD-MAG", 2, monday, addDays(monday, 90), "Du suvirintojai su ISO 9606-1, be vairuotojo")
        await capacity("PMU", "SHIP-FIT", 2, monday, addDays(monday, 90), "")
        await capacity("PSS", "WELD-MAG", 2, monday, null, "Kalba tik lenkiškai")
        await capacity("PSS", "WELD-TIG", 2, addDays(monday, 14), null, "Nuo gruodžio")

        // ---- team composition rules per client
        let rules = 0
        const rule = async (code: string, driversPerPeople: number, english: EnglishScope, housingGroupSize: number, note: string) => {
          const clientId = client.get(code)
          if (!clientId) return
          if (
            await db
              .query("staffing_planning_clientRules")
              .withIndex("by_client", (q) => q.eq("clientId", clientId))
              .first()
          )
            return
          await db.insert("staffing_planning_clientRules", { clientId, driversPerPeople, english, languageCompatibility: true, housingGroupSize, note, createdBy: SEED, updatedAt: now })
          rules++
        }
        await rule("RDW", 4, "housing", 4, "Kiekviename būste bent vienas kalbantis angliškai (saugos instruktažai anglų k.)")
        await rule("SDO", 5, "team", 5, "Būstai po 5, vienas automobilis būstui")
        await rule("BDI", 4, "team", 4, "")

        // ---- feedback per worker per client
        let feedback = 0
        const note = async (first: string, last: string, code: string, verdict: "suitable" | "unsuitable", comment: string) => {
          const wid = worker(first, last)
          const clientId = client.get(code)
          if (!wid || !clientId) return
          if (
            await db
              .query("staffing_planning_feedback")
              .withIndex("by_worker", (q) => q.eq("workerId", wid).eq("clientId", clientId))
              .first()
          )
            return
          await db.insert("staffing_planning_feedback", { workerId: wid, clientId, verdict, comment, createdBy: SEED, updatedAt: now })
          feedback++
        }
        await note("Rodel", "Halimbawa", "RDW", "unsuitable", "Klientas paprašė pakeisti: lėtas darbas ant vertikalių siūlių, du kartus perdarinėta.")
        await note("Jose", "Halimbawa", "RDW", "suitable", "Klientas prašo grąžinti: geras brigados lyderis, kalba angliškai su meistru.")
        await note("Taras", "Prykladnyi", "RDW", "suitable", "Dirbo 2 projektuose, pastabų nėra.")
        await note("Egidijus", "Bandymas", "BDI", "suitable", "")
        await note("Ion", "Exemplu", "SDO", "unsuitable", "Nesusikalba su meistru (tik rumunų k.).")

        // ---- the two new requests for Monday: 15 + 10 people
        let requests = 0
        const weld = certTypes.get("Suvirintojo sertifikatas EN ISO 9606-1")
        const request = async (code: string, projectName: string, site: string, end: string, lines: { trade: string; count: number; drivers: number; weld?: boolean }[], notes: string) => {
          const clientId = client.get(code)
          if (!clientId) return
          const prior = (
            await db
              .query("staffing_teams_requests")
              .withIndex("by_client", (q) => q.eq("clientId", clientId))
              .collect()
          ).find((r) => r.projectName === projectName)
          if (prior) return
          await db.insert("staffing_teams_requests", {
            clientId,
            projectName,
            country: "NL",
            site,
            startDate: monday,
            endDate: end,
            lines: lines.filter((l) => trades.has(l.trade)).map((l) => ({ tradeId: tradeId(l.trade), count: l.count, drivers: l.drivers, certificateTypeIds: l.weld && weld ? [weld] : [] })),
            languages: ["en"],
            notes,
            status: "open",
            assignmentIds: [],
            createdBy: SEED,
            updatedAt: now,
          })
          requests++
        }
        await request(
          "RDW",
          "Naujo laivo korpuso sekcijos",
          "Rotterdam",
          addDays(monday, 55),
          [
            { trade: "WELD-MAG", count: 12, drivers: 3, weld: true },
            { trade: "SHIP-FIT", count: 3, drivers: 0 },
          ],
          "Reikia pirmadieniui. Klientas prašo tų pačių žmonių, kurie dirbo prie doko vartų. Kiekviename būste bent vienas angliškai kalbantis.",
        )
        await request(
          "SDO",
          "Platformos modulių suvirinimas",
          "Schiedam",
          addDays(monday, 41),
          [
            { trade: "WELD-MAG", count: 6, drivers: 1, weld: true },
            { trade: "PIPE-FIT", count: 4, drivers: 1 },
          ],
          "Reikia pirmadieniui, 6 savaitės. Vamzdynininkai su karštųjų darbų pažymėjimu.",
        )

        return { seeded: true, workers: newWorkers, availability, capacities, rules, feedback, requests }
      },
    }),
  }
}
