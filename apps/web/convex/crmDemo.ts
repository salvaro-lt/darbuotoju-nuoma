// Demo CRM data (fictional companies and people): `npx convex run crmDemo:seed`.
// Idempotent (records with an existing label are skipped). Refuses in production.
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"

type Rec = { ref?: string; objectKey: string; values: Record<string, unknown> }

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const eur = (amount: number) => ({ amount: amount * 100, currency: "EUR" })

const companies: Rec[] = [
  { ref: "c1", objectKey: "company", values: { name: "Nordhaven Shipyard BV (demo)", sector: "shipbuilding", country: "Nyderlandai", clientStatus: "recurring", leadSource: "referral", invoicingPeriod: "weekly", paymentTermsDays: 30, timesheetFormat: "excel", samePeopleWanted: true, isCustomer: true } },
  { ref: "c2", objectKey: "company", values: { name: "Fjordstal AS (demo)", sector: "steel", country: "Norvegija", clientStatus: "active", leadSource: "fair", invoicingPeriod: "monthly", paymentTermsDays: 45, timesheetFormat: "pdf", isCustomer: true } },
  { ref: "c3", objectKey: "company", values: { name: "Baltic Hull Works (demo)", sector: "shipbuilding", country: "Lenkija", clientStatus: "active", leadSource: "event", invoicingPeriod: "biweekly", paymentTermsDays: 30, timesheetFormat: "photo", isCustomer: true } },
  { ref: "c4", objectKey: "company", values: { name: "Rhein Anlagenbau GmbH (demo)", sector: "industrial", country: "Vokietija", clientStatus: "prospect", leadSource: "fair", invoicingPeriod: "monthly", paymentTermsDays: 30, timesheetFormat: "portal" } },
  { ref: "c5", objectKey: "company", values: { name: "Vestkyst Energi (demo)", sector: "energy", country: "Danija", clientStatus: "prospect", leadSource: "referral", paymentTermsDays: 30 } },
]

const people: Rec[] = [
  { ref: "p1", objectKey: "person", values: { name: "Pieter de Vries (demo)", email: "pieter@example.com", jobTitle: "Production manager", contactRole: "site_manager", language: "en", company: "@c1" } },
  { ref: "p2", objectKey: "person", values: { name: "Anouk Jansen (demo)", email: "anouk@example.com", jobTitle: "Accounts payable", contactRole: "accounting", language: "en", company: "@c1" } },
  { ref: "p3", objectKey: "person", values: { name: "Lars Haugen (demo)", email: "lars@example.com", jobTitle: "Procurement", contactRole: "procurement", language: "en", company: "@c2" } },
  { ref: "p4", objectKey: "person", values: { name: "Marek Nowak (demo)", email: "marek@example.com", jobTitle: "Site manager", contactRole: "site_manager", language: "en", company: "@c3" } },
  { ref: "p5", objectKey: "person", values: { name: "Jonas Becker (demo)", email: "jonas.becker@example.com", jobTitle: "Projektleiter", contactRole: "project_manager", language: "de", company: "@c4" } },
  { ref: "p6", objectKey: "person", values: { name: "Mette Larsen (demo)", email: "mette@example.com", jobTitle: "Project director", contactRole: "director", language: "en", company: "@c5" } },
]

const requests: Rec[] = [
  { objectKey: "request", values: { name: "Nordhaven: 6 suvirintojai korpusui", stage: "new", company: "@c1", contact: "@p1", receivedAt: day(-1), channel: "email", trades: ["welder_mig", "fitter"], workersNeeded: 6, driversNeeded: 1, startDate: day(21), durationWeeks: 10, country: "Nyderlandai", site: "Vlissingen", requirements: "EN ISO 9606-1 135/136, VCA, anglų kalba bent vienam komandoje", estimatedValue: eur(42000) } },
  { objectKey: "request", values: { name: "Fjordstal: vamzdynų montuotojai", stage: "staffing", company: "@c2", contact: "@p3", receivedAt: day(-3), channel: "phone", trades: ["pipefitter", "welder_tig"], workersNeeded: 4, driversNeeded: 1, startDate: day(14), durationWeeks: 8, country: "Norvegija", site: "Stavanger", requirements: "TIG 141 nerūdijančiam plienui, A1 pažyma", estimatedValue: eur(31000) } },
  { objectKey: "request", values: { name: "Baltic Hull: komandos papildymas", stage: "proposal_sent", company: "@c3", contact: "@p4", receivedAt: day(-6), channel: "message", trades: ["fitter", "grinder"], workersNeeded: 3, startDate: day(7), durationWeeks: 6, country: "Lenkija", site: "Gdańsk", estimatedValue: eur(15000), responseHours: 30 } },
  { objectKey: "request", values: { name: "Nordhaven: dažytojai sekcijoms", stage: "confirmed", company: "@c1", contact: "@p1", receivedAt: day(-20), channel: "email", trades: ["painter"], workersNeeded: 2, startDate: day(-5), durationWeeks: 8, country: "Nyderlandai", site: "Vlissingen", estimatedValue: eur(16000), responseHours: 20 } },
  { objectKey: "request", values: { name: "Rhein Anlagenbau: elektros montavimas", stage: "lost", company: "@c4", contact: "@p5", receivedAt: day(-30), channel: "fair", trades: ["electrician", "foreman"], workersNeeded: 5, startDate: day(-10), durationWeeks: 12, country: "Vokietija", site: "Duisburg", estimatedValue: eur(54000), responseHours: 52, lostReason: "competitor_faster" } },
  { objectKey: "request", values: { name: "Vestkyst: vėjo jėgainių pamatai", stage: "new", company: "@c5", contact: "@p6", receivedAt: day(0), channel: "email", trades: ["welder_mma", "welder_mig", "foreman"], workersNeeded: 8, driversNeeded: 2, startDate: day(35), durationWeeks: 16, country: "Danija", site: "Esbjerg", requirements: "Brigadininkas su anglų k., GWO saugos mokymai", estimatedValue: eur(96000) } },
]

export const seed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ created: number; skipped: number }> => {
    if (process.env.APP_ENV === "production") throw new Error("crmDemo:seed refuses to run in production")
    await ctx.runMutation(internal.crm._applyBlueprint, {})
    return await ctx.runMutation(internal.crm._seedRecords, { records: [...companies, ...people, ...requests] })
  },
})
