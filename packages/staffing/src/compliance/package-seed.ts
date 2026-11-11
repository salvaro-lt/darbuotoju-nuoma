// Demo data of the client document package (DIG-113), run by compliance:_seedDemo
// (through _seedFiles, after the scans exist). Idempotent; refuses in production.
//   1. VSB-2026-14: a complete team → package `ready` (one click to send).
//   2. VSB-2026-12: two workers without a valid VCA → package `needs_approval`.
//   3. A send history: earlier packages already sent, with link downloads.
import { internalMutationGeneric, type FunctionReference } from "convex/server"
import { v } from "convex/values"
import { addDays, addMonths, todayIso } from "../pure"
import { writerOf, type ProjectId, type WorkerId } from "../shared"
import { type ComplianceDataModel } from "./operations"
import { buildPackageDraft, insertPackage, issuePackageLink, packageLinkUrl, type PackageId } from "./package-operations"
import { logSends } from "./package-functions"

export const PACKAGE_DEMO_NOTE = "compliance-demo"
const READY_CODE = "VSB-2026-14"
const BLOCKED_CODE = "VSB-2026-12"
const DAY = 86_400_000

export function definePackageSeed(o: { ref: (name: string) => unknown; companyName: string }) {
  return {
    /** Dev only. Phase 1 adds the complete demo project (then scans are made); phase 2 the packages and their history. */
    _seedPackages: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ phase: "project" | "packages" | "done"; packages: number }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`compliance:_seedPackages refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<ComplianceDataModel>(ctx)
        if (a.reset)
          for (const t of ["staffing_compliance_packageSends", "staffing_compliance_packageDownloads", "staffing_compliance_packageLinks", "staffing_compliance_packages", "staffing_compliance_packageSettings"] as const)
            for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
        const now = Date.now()
        const today = todayIso()
        const byCode = (code: string) =>
          db
            .query("staffing_projects")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
        const blocked = await byCode(BLOCKED_CODE)
        if (!blocked) throw new Error("Run compliance:_seedDemo first (project VSB-2026-12 missing)")

        // ---- phase 1: the complete project (same client, right after VSB-2026-12).
        const ready = await byCode(READY_CODE)
        if (!ready) {
          const workers = await db.query("staffing_workers").collect()
          const worker = (first: string, last: string): WorkerId => {
            const w = workers.find((x) => x.firstName === first && x.lastName === last)
            if (!w) throw new Error(`Worker ${first} ${last} missing: run staffing:_seedDemo first`)
            return w._id
          }
          const trade = async (code: string) =>
            (await db
              .query("staffing_trades")
              .withIndex("by_code", (q) => q.eq("code", code))
              .first())!._id
          const start = addDays(today, 75)
          const end = addDays(today, 130)
          const team: [string, string, string][] = [
            ["Saulius", "Mėginys", "ELEC"],
            ["Dmytro", "Demchenko-Test", "GRINDER"],
            ["Andris", "Testiņš", "FITTER"],
          ]
          const tradeIds = new Map<string, Awaited<ReturnType<typeof trade>>>()
          for (const [, , c] of team) tradeIds.set(c, await trade(c))
          const projectId = await db.insert("staffing_projects", {
            clientId: blocked.clientId,
            name: "Denio sekcijų montavimas",
            code: READY_CODE,
            country: "NL",
            city: "Vlissingen",
            siteAddress: "Scheldekade (demo aikštelė)",
            startDate: start,
            endDate: end,
            status: "active",
            rates: [...tradeIds.values()].map((tradeId) => ({ tradeId, hourlyRateCents: 4400 })),
            currency: "EUR",
            notes: "Demo projektas dokumentų paketui: visi komandos dokumentai galioja, paketas paruoštas siųsti.",
            updatedAt: now,
          })
          for (const [f, l, c] of team)
            await db.insert("staffing_assignments", { projectId, workerId: worker(f, l), tradeId: tradeIds.get(c)!, startDate: start, endDate: end, status: "confirmed", isDriver: false, notes: "", createdBy: "seed", updatedAt: now })
          // Fresh copies of every document NL requires, so the package is complete.
          const types = await db.query("staffing_certificateTypes").collect()
          const typeId = (name: string) => types.find((t) => t.name === name)?._id
          let n = 0
          for (const [f, l] of team)
            for (const [name, months] of [["Pasas", 96], ["A1 pažyma", 12], ["Saugos instruktažas", 14], ["VCA / SCC", 120], ["Darbo leidimas", 18]] as const) {
              const certificateTypeId = typeId(name)
              if (!certificateTypeId) continue
              const expiresAt = addMonths(today, months)
              await db.insert("staffing_workerCertificates", { workerId: worker(f, l), certificateTypeId, number: `${name.slice(0, 2).toUpperCase()}-${51200 + n++ * 37}`, issuedAt: addMonths(expiresAt, -24), expiresAt, notes: PACKAGE_DEMO_NOTE, updatedAt: now })
            }
          // Scans for the new certificates; _seedFiles calls this again (phase 2).
          await ctx.scheduler.runAfter(0, o.ref("_seedFiles") as FunctionReference<"action", "internal">, {})
          return { phase: "project", packages: 0 }
        }

        // ---- phase 2: packages (once).
        if (await db.query("staffing_compliance_packages").first()) return { phase: "done", packages: 0 }
        const build = { companyName: o.companyName }
        const redirect = (process.env.SUPER_USER_EMAILS ?? "").split(",")[0]?.trim()
        let packages = 0
        const make = async (projectId: ProjectId, s: { workers?: WorkerId[]; by: string; trigger: "ui" | "ai" | "seed"; sentDaysAgo?: number; approvedBy?: string; downloads?: number; note?: string }): Promise<PackageId | null> => {
          const draft = await buildPackageDraft(ctx, { projectId, ...(s.workers ? { workerIds: s.workers } : {}), ...(s.note ? { note: s.note } : {}) }, build)
          if (!draft || !draft.members.length) return null
          const { packageId } = await insertPackage(ctx, draft, { trigger: s.trigger, createdBy: "seed", createdByName: s.by, note: s.note, sendIfComplete: false, now })
          packages++
          if (s.sentDaysAgo !== undefined) {
            const sentAt = now - s.sentDaysAgo * DAY
            const link = await issuePackageLink(ctx, packageId, s.by, 14, sentAt)
            await db.patch("staffing_compliance_packages", packageId, { status: "sent", sentAt, queuedAt: sentAt, ...(redirect ? { redirectedTo: redirect } : {}), ...(s.approvedBy ? { approvedByName: s.approvedBy, approvedAt: sentAt } : {}) })
            for (let i = 0; i < (s.downloads ?? 0); i++) await db.insert("staffing_compliance_packageDownloads", { linkId: link.linkId, packageId, kind: i === 0 ? "view" : "zip", at: sentAt + (i + 1) * 3_600_000 })
            if (s.downloads) await db.patch("staffing_compliance_packageLinks", link.linkId, { downloads: Math.max(0, s.downloads - 1), lastAccessAt: sentAt + s.downloads * 3_600_000 })
            await logSends(ctx, packageId, sentAt)
          }
          return packageId
        }
        const team = (await db
          .query("staffing_assignments")
          .withIndex("by_project", (q) => q.eq("projectId", blocked._id))
          .collect()).filter((x) => x.status === "confirmed" || x.status === "active")
        // History first (oldest), then the two open packages on top.
        const nds = await byCode("NDS-2026-07")
        if (nds) await make(nds._id, { by: "Demo planuotojas", trigger: "ui", sentDaysAgo: 21, approvedBy: "Demo planuotojas", downloads: 3 })
        await make(blocked._id, { workers: team.slice(1, 3).map((x) => x.workerId), by: "Demo planuotojas", trigger: "ui", sentDaysAgo: 9, approvedBy: "Demo planuotojas", downloads: 2, note: "Pirmieji du komandos nariai; likusių dokumentus atsiųsime atskirai." })
        await make(blocked._id, { by: "Asistentas (DI) · Demo planuotojas", trigger: "ai" })
        await make(ready._id, { by: "Demo planuotojas", trigger: "ui" })
        await db.insert("staffing_compliance_packageSettings", { projectId: ready._id, autoSend: false, updatedAt: now })
        return { phase: "packages", packages }
      },
    }),

    /** Dev only: a fresh public link to the newest package of a project, to open `/d/<token>` without signing in. */
    _seedPackageLink: internalMutationGeneric({
      args: { projectCode: v.optional(v.string()) },
      handler: async (ctx, a): Promise<{ url: string; status: string } | null> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`compliance:_seedPackageLink refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = writerOf<ComplianceDataModel>(ctx)
        const project = await db
          .query("staffing_projects")
          .withIndex("by_code", (q) => q.eq("code", a.projectCode ?? BLOCKED_CODE))
          .first()
        if (!project) return null
        const p = await db
          .query("staffing_compliance_packages")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .order("desc")
          .first()
        if (!p) return null
        const l = await issuePackageLink(ctx, p._id, "seed")
        return { url: packageLinkUrl(l.token), status: p.status }
      },
    }),
  }
}
