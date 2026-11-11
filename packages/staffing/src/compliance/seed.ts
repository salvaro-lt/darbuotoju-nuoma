// Demo data of the compliance area, on top of `staffing:_seedDemo`:
//   npx convex run compliance:_seedDemo            (skips when templates exist)
//   npx convex run compliance:_seedDemo '{"reset":true}'
// Refuses when APP_ENV is production or unset. All names are fictional.
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, type FunctionReference } from "convex/server"
import { v } from "convex/values"
import { addDays, addMonths, fullName, todayIso } from "../pure"
import { writerOf, type AssignmentId, type CertificateTypeId, type StorageId, type WorkerId } from "../shared"
import { draftContract, type ComplianceDataModel, type TemplateId } from "./operations"
import { simplePdf, type RequirementScope } from "./pure"
import { definePackageSeed } from "./package-seed"

const DEMO_NOTE = "compliance-demo"

export const DEMO_TEMPLATES: { name: string; language: "lt" | "en"; description: string; body: string }[] = [
  {
    name: "Darbo sutartis (LT)",
    language: "lt",
    description: "Terminuota darbo sutartis darbui komandiruotėje",
    body: `# TERMINUOTA DARBO SUTARTIS

Sudaryta {{today}}

{{company.name}} (toliau – Darbdavys) ir {{worker.fullName}}, asmens kodas {{worker.personalCode?}}, pilietybė {{worker.nationality}}, gyvenamoji vieta {{worker.homeCity}}, {{worker.homeCountry}} (toliau – Darbuotojas), sudarė šią sutartį.

## 1. Darbo funkcija

Darbuotojas priimamas dirbti pareigose: {{trade}}. Darbas atliekamas projekte „{{project.name}}“ ({{project.code}}), kliento {{client.name}} objekte {{project.city}}, {{project.country}}.

## 2. Terminas

Sutartis galioja nuo {{assignment.startDate}} iki {{assignment.endDate?}} (projekto pabaigos). Darbuotojas siunčiamas į komandiruotę užsienyje visam šiam laikotarpiui.

## 3. Darbo užmokestis

Valandinis atlygis – {{hourlyRate}} {{currency}} (neatskaičius mokesčių). Dienpinigiai ir apgyvendinimas – pagal Darbdavio komandiruočių tvarką.

## 4. Kitos sąlygos

Darbuotojas privalo turėti galiojančius dokumentus, reikalingus darbui {{project.country}} (A1 pažyma, saugos instruktažai, kvalifikacijos pažymėjimai), ir laikytis kliento objekto saugos taisyklių.

Darbdavys: ____________________          Darbuotojas: ____________________
{{company.name}}                                        {{worker.fullName}}`,
  },
  {
    name: "Komandiruotės įsakymas / Posting notice (EN)",
    language: "en",
    description: "Posting notice for the client and the host country authorities",
    body: `# POSTING NOTICE

Date: {{today}}

## Employer

{{company.name}}, Lithuania

## Posted worker

Name: {{worker.fullName}}
Nationality: {{worker.nationality}}
Personal code: {{worker.personalCode?}}
Trade: {{tradeEn}}

## Place of work

Client: {{client.name}} ({{client.country}}), VAT {{client.vatCode?}}
Project: {{project.name}} ({{project.code}})
Site: {{project.siteAddress?}}, {{project.city}}, {{project.country}}

## Period

From {{assignment.startDate}} to {{assignment.endDate?}}

The worker remains employed by the employer during the posting and is covered by Lithuanian social security (A1 certificate). The employer guarantees the host country's minimum terms of employment.

Signed for the employer: ____________________`,
  },
]

// Requirements per country (certificate type names from the staffing seed).
const COUNTRY_REQUIREMENTS: Record<string, [type: string, scope: RequirementScope][]> = {
  NL: [["Pasas", "all"], ["A1 pažyma", "all"], ["Saugos instruktažas", "all"], ["VCA / SCC", "all"], ["Darbo leidimas", "nonEea"]],
  NO: [["Pasas", "all"], ["A1 pažyma", "all"], ["Saugos instruktažas", "all"], ["HMS kortelė", "all"], ["Darbo leidimas", "nonEea"]],
  DE: [["Pasas", "all"], ["A1 pažyma", "all"], ["Saugos instruktažas", "all"], ["Medicininė pažyma", "all"], ["Darbo leidimas", "nonEea"]],
  PL: [["Pasas", "all"], ["A1 pažyma", "all"], ["Saugos instruktažas", "all"], ["Darbo leidimas", "nonEea"]],
}

type Ref = (name: string) => FunctionReference<"query" | "mutation" | "action", "internal">

export function defineComplianceSeed(o: { ref: (name: string) => unknown; companyName?: string }) {
  const ref = o.ref as Ref
  return {
    /** Dev only. Requirements, a demo NL project with two blockers, expiring documents, 2 templates, a few contracts; then scans for the certificates. */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; requirements: number; certificates: number; contracts: number }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`compliance:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<ComplianceDataModel>(ctx)
        if (a.reset) {
          for (const t of [
            "staffing_compliance_contracts",
            "staffing_compliance_templates",
            "staffing_compliance_requirements",
            "staffing_compliance_digestLog",
            "staffing_compliance_digestRuns",
            "staffing_compliance_packageSends",
            "staffing_compliance_packageDownloads",
            "staffing_compliance_packageLinks",
            "staffing_compliance_packages",
            "staffing_compliance_packageSettings",
          ] as const)
            for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
          for (const c of await db.query("staffing_workerCertificates").collect()) if (c.notes === DEMO_NOTE) await db.delete("staffing_workerCertificates", c._id)
          const client = await db
            .query("staffing_clients")
            .withIndex("by_code", (q) => q.eq("code", "VSB"))
            .first()
          if (client) {
            for (const p of await db
              .query("staffing_projects")
              .withIndex("by_client", (q) => q.eq("clientId", client._id))
              .collect()) {
              for (const x of await db
                .query("staffing_assignments")
                .withIndex("by_project", (q) => q.eq("projectId", p._id))
                .collect())
                await db.delete("staffing_assignments", x._id)
              await db.delete("staffing_projects", p._id)
            }
            await db.delete("staffing_clients", client._id)
          }
        } else if (await db.query("staffing_compliance_templates").first()) {
          // Already seeded: still add the document package demo (DIG-113) if it is missing.
          await ctx.scheduler.runAfter(0, ref("_seedFiles") as FunctionReference<"action", "internal">, {})
          return { seeded: false, requirements: 0, certificates: 0, contracts: 0 }
        }
        const now = Date.now()
        const today = todayIso()

        // ---- catalog: the base seed's certificate types, plus the Norwegian HMS card.
        const types = await db.query("staffing_certificateTypes").collect()
        if (!types.length) throw new Error("Run staffing:_seedDemo first")
        let hms = types.find((t) => t.name === "HMS kortelė")
        if (!hms) {
          const id = await db.insert("staffing_certificateTypes", { name: "HMS kortelė", nameEn: "HMS card (Norway)", appliesTo: "worker", mandatory: false, defaultValidityMonths: 24, position: Math.max(...types.map((t) => t.position)) + 1 })
          hms = (await db.get("staffing_certificateTypes", id))!
          types.push(hms)
        }
        const type = (name: string): CertificateTypeId => {
          const t = types.find((x) => x.name === name)
          if (!t) throw new Error(`Certificate type "${name}" missing: run staffing:_seedDemo '{"reset":true}' first`)
          return t._id
        }

        // ---- requirements per country and one client-specific one.
        let requirements = 0
        for (const [country, list] of Object.entries(COUNTRY_REQUIREMENTS))
          for (const [name, scope] of list) {
            await db.insert("staffing_compliance_requirements", { certificateTypeId: type(name), country, scope, updatedAt: now })
            requirements++
          }
        const nds = await db
          .query("staffing_clients")
          .withIndex("by_code", (q) => q.eq("code", "NDS"))
          .first()
        if (nds) {
          await db.insert("staffing_compliance_requirements", { certificateTypeId: type("Karštieji darbai"), clientId: nds._id, scope: "all", note: "Kliento reikalavimas visiems korpuso darbams", updatedAt: now })
          requirements++
        }

        // ---- workers by name (the base seed's fictional people).
        const workers = await db.query("staffing_workers").collect()
        const worker = (first: string, last: string): WorkerId => {
          const w = workers.find((x) => x.firstName === first && x.lastName === last)
          if (!w) throw new Error(`Worker ${first} ${last} missing: run staffing:_seedDemo first`)
          return w._id
        }
        let certificates = 0
        const cert = async (workerId: WorkerId, name: string, expiresAt: string, number?: string) => {
          certificates++
          await db.insert("staffing_workerCertificates", { workerId, certificateTypeId: type(name), ...(number ? { number } : {}), issuedAt: addMonths(expiresAt, -24), expiresAt, notes: DEMO_NOTE, updatedAt: now })
        }

        // Norway project NDS-2026-07: HMS cards for its team, hot-work training for the fitters.
        const ndsTeam: [string, string][] = [
          ["Antanas", "Testinis"],
          ["Jonas", "Pavyzdys"],
          ["Petras", "Bandomasis"],
          ["Oleksandr", "Testenko"],
          ["Andrii", "Prykladenko"],
          ["Serhii", "Zrazkovych"],
          ["Krzysztof", "Próbny"],
          ["Jānis", "Paraugs"],
        ]
        for (const [i, [f, l]] of ndsTeam.entries()) await cert(worker(f, l), "HMS kortelė", i === 1 ? addDays(today, 50) : addMonths(today, 14 + i), `HMS-${40210 + i * 17}`)
        await cert(worker("Andrii", "Prykladenko"), "Karštieji darbai", addMonths(today, 30), `KD-${7710}`)
        await cert(worker("Krzysztof", "Próbny"), "Karštieji darbai", addDays(today, 25), `KD-${7744}`)

        // ---- the demo NL project: a confirmed team of five with two blockers.
        const trade = async (code: string) =>
          (await db
            .query("staffing_trades")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first())!._id
        const clientId = await db.insert("staffing_clients", {
          name: "Voorbeeld Scheepsbouw B.V.",
          code: "VSB",
          kind: "client",
          country: "NL",
          vatCode: "NL000099999B01",
          address: "Vlissingen, NL (demo)",
          contacts: [{ name: "VSB projectleider (demo)", role: "Project manager", email: "pm@vsb.example", phone: "+31 000 000" }],
          defaultRates: [],
          currency: "EUR",
          paymentTermsDays: 30,
          invoicingPeriod: "monthly",
          notes: "Demonstracinis klientas (dokumentų modulis).",
          updatedAt: now,
        })
        const start = addDays(today, 10)
        const end = addDays(today, 70)
        const codes = ["GRINDER", "ELEC", "BLAST-PAINT", "FITTER"]
        const rates = { GRINDER: 3700, ELEC: 4800, "BLAST-PAINT": 3900, FITTER: 4200 } as Record<string, number>
        const tradeIds = new Map<string, Awaited<ReturnType<typeof trade>>>()
        for (const c of codes) tradeIds.set(c, await trade(c))
        const projectId = await db.insert("staffing_projects", {
          clientId,
          name: "Sekcijų šlifavimas ir dažymas",
          code: "VSB-2026-12",
          country: "NL",
          city: "Vlissingen",
          siteAddress: "Scheldekade (demo aikštelė)",
          startDate: start,
          endDate: end,
          status: "active",
          rates: codes.map((c) => ({ tradeId: tradeIds.get(c)!, hourlyRateCents: rates[c]! })),
          currency: "EUR",
          notes: "Demo projektas dokumentų pasirengimui: du darbuotojai dar neturi tinkamo VCA.",
          updatedAt: now,
        })
        const team: [first: string, last: string, code: string][] = [
          ["Darius", "Demonstras", "GRINDER"],
          ["Saulius", "Mėginys", "ELEC"],
          ["Dmytro", "Demchenko-Test", "GRINDER"],
          ["Vasyl", "Zrazok", "BLAST-PAINT"],
          ["Andris", "Testiņš", "FITTER"],
        ]
        const assignments: AssignmentId[] = []
        for (const [f, l, c] of team)
          assignments.push(await db.insert("staffing_assignments", { projectId, workerId: worker(f, l), tradeId: tradeIds.get(c)!, startDate: start, endDate: end, status: "confirmed", isDriver: f === "Andris", notes: "", createdBy: "seed", updatedAt: now }))
        // VCA: Darius expired (blocker), Vasyl none (blocker), Andris expiring in 50 days.
        await cert(worker("Darius", "Demonstras"), "VCA / SCC", addDays(today, -12), "VCA-118204")
        await cert(worker("Saulius", "Mėginys"), "VCA / SCC", addMonths(today, 70), "VCA-120377")
        await cert(worker("Dmytro", "Demchenko-Test"), "VCA / SCC", addMonths(today, 90), "VCA-121950")
        await cert(worker("Andris", "Testiņš"), "VCA / SCC", addDays(today, 50), "VCA-109822")
        // Renewals so the rest of the team is fine for the whole project.
        await cert(worker("Saulius", "Mėginys"), "A1 pažyma", addMonths(today, 6), "A1-2026-5507")
        await cert(worker("Saulius", "Mėginys"), "Saugos instruktažas", addMonths(today, 12))
        await cert(worker("Vasyl", "Zrazok"), "A1 pažyma", addMonths(today, 7), "A1-2026-5512")
        await cert(worker("Andris", "Testiņš"), "A1 pažyma", addMonths(today, 9), "A1-2026-5520")

        // ---- contract templates and a few generated contracts.
        const tpl: TemplateId[] = []
        for (const t of DEMO_TEMPLATES) tpl.push(await db.insert("staffing_compliance_templates", { ...t, updatedAt: now }))
        let contracts = 0
        const generate = async (templateId: TemplateId, assignmentId: (typeof assignments)[number]) => {
          const d = await draftContract(ctx, templateId, assignmentId, { ...(o.companyName ? { companyName: o.companyName } : {}), today })
          if (!d) return
          await db.insert("staffing_compliance_contracts", { templateId, templateName: d.templateName, language: d.language, title: d.title, body: d.body, missing: d.missing, workerId: d.workerId, assignmentId, projectId: d.projectId, createdBy: "seed" })
          contracts++
        }
        await generate(tpl[0]!, assignments[1]!)
        await generate(tpl[0]!, assignments[4]!)
        await generate(tpl[1]!, assignments[1]!)
        await generate(tpl[1]!, assignments[2]!)
        await generate(tpl[1]!, assignments[4]!)

        // Scans for the certificates, in the background (actions can store files, mutations can't).
        await ctx.scheduler.runAfter(0, ref("_seedFiles") as FunctionReference<"action", "internal">, {})
        return { seeded: true, requirements, certificates, contracts }
      },
    }),

    _seedFileTargets: internalQueryGeneric({
      args: {},
      handler: async (ctx) => {
        const db = writerOf<ComplianceDataModel>(ctx)
        const rows = (await db.query("staffing_workerCertificates").take(1000)).filter((c) => !c.fileStorageId).slice(0, 400)
        const out = []
        for (const c of rows) {
          const [w, t] = await Promise.all([db.get("staffing_workers", c.workerId), db.get("staffing_certificateTypes", c.certificateTypeId)])
          if (w && t) out.push({ certificateId: c._id, worker: fullName(w), nationality: w.nationality, type: t.nameEn ?? t.name, typeLt: t.name, number: c.number ?? null, issuedAt: c.issuedAt ?? null, expiresAt: c.expiresAt ?? null })
        }
        return out
      },
    }),

    /** Dev only: a one-page PDF "scan" for every certificate without a file. */
    _seedFiles: internalActionGeneric({
      args: {},
      handler: async (ctx): Promise<number> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") return 0
        const targets = (await ctx.runQuery(ref("_seedFileTargets") as FunctionReference<"query", "internal">, {})) as {
          certificateId: string
          worker: string
          nationality: string
          type: string
          typeLt: string
          number: string | null
          issuedAt: string | null
          expiresAt: string | null
        }[]
        for (const t of targets) {
          const pdf = simplePdf(t.type, [
            `Holder: ${t.worker} (${t.nationality})`,
            `Document: ${t.typeLt}`,
            `Number: ${t.number ?? "-"}`,
            `Issued: ${t.issuedAt ?? "-"}`,
            `Valid until: ${t.expiresAt ?? "no expiry"}`,
            "",
            "DEMO DOCUMENT - not a real certificate",
          ])
          const storageId = await ctx.storage.store(new Blob([pdf as BlobPart], { type: "application/pdf" }))
          const fileName = `${t.worker} - ${t.type}.pdf`.replace(/[\\/:*?"<>|]+/g, "_")
          await ctx.runMutation(ref("_attachSeedFile") as FunctionReference<"mutation", "internal">, { certificateId: t.certificateId, storageId, fileName })
        }
        // The client document package demo (DIG-113) needs the scans first.
        await ctx.runMutation(ref("_seedPackages") as FunctionReference<"mutation", "internal">, {})
        return targets.length
      },
    }),

    _attachSeedFile: internalMutationGeneric({
      args: { certificateId: v.id("staffing_workerCertificates"), storageId: v.id("_storage"), fileName: v.string() },
      handler: async (ctx, a) => {
        const db = writerOf<ComplianceDataModel>(ctx)
        const c = await db.get("staffing_workerCertificates", a.certificateId)
        if (!c || c.fileStorageId) return
        await db.patch("staffing_workerCertificates", c._id, { fileStorageId: a.storageId as StorageId, fileName: a.fileName })
      },
    }),

    ...definePackageSeed({ ref: o.ref, companyName: o.companyName ?? "" }),
  }
}
