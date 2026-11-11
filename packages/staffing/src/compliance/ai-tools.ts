// AI tools of the compliance area: readiness (read-only) and the client
// document package (DIG-113, approval-gated).
import { defineAiTool } from "@digimuza/system-core/ai"
import { recordAudit } from "@digimuza/system-core/convex"
import { z } from "zod"
import { fold } from "../pure"
import { actorId } from "../shared"
import { StaffingCompliancePermissions } from "./manifest"
import { complianceReader, projectReadiness } from "./operations"
import { actorName, buildPackageDraft, insertPackage } from "./package-operations"
import { cleanRecipients } from "./package-functions"
import { PACKAGE_LANGUAGES } from "./pure"

export const complianceProjectReadinessTool = defineAiTool({
  id: "staffing-compliance.project_readiness",
  description:
    "Document readiness of a project's team: the documents required in the project's country and by its client (A1, safety induction, VCA, HMS card, work permit…), and for each team member which are valid, expiring (within 30/60 days or during the project), expired or missing. Find the project by code or name.",
  permission: StaffingCompliancePermissions.readinessRead,
  input: z.object({ project: z.string().trim().min(1).max(100).describe("Project code (e.g. VSB-2026-12) or part of its name") }),
  handler: async (ctx, input) => {
    const needle = fold(input.project)
    const projects = await complianceReader(ctx).query("staffing_projects").take(1000)
    const p = projects.find((x) => fold(x.code) === needle) ?? projects.find((x) => fold(x.code).includes(needle) || fold(x.name).includes(needle))
    if (!p) return { found: false }
    const r = (await projectReadiness(ctx, p._id))!
    return {
      found: true,
      project: `${r.project.code} ${r.project.name}`,
      client: r.project.clientName,
      country: r.project.country,
      period: `${r.project.startDate} – ${r.project.endDate ?? "open"}`,
      requiredDocuments: r.documents.map((d) => (d.scope === "nonEea" ? `${d.nameEn ?? d.name} (non-EU/EEA workers only)` : (d.nameEn ?? d.name))),
      readiness: r.readiness,
      counts: r.counts,
      team: r.rows.map((row) => ({
        worker: row.workerName,
        trade: row.tradeName,
        assignment: row.assignmentStatus,
        readiness: row.readiness,
        blockers: row.blockers,
        warnings: row.warnings,
        documents: Object.fromEntries(r.documents.map((d, i) => [d.nameEn ?? d.name, { status: row.cells[i]!.status, expiresAt: row.cells[i]!.expiresAt, expiresDuringProject: row.cells[i]!.expiresDuring }])),
      })),
      link: `/app/compliance/projects/${p._id}`,
    }
  },
})

/** Finds a project by exact code, else by part of its code or name. */
async function findProject(ctx: { db: unknown }, query: string) {
  const needle = fold(query)
  const projects = await complianceReader(ctx).query("staffing_projects").take(1000)
  return projects.find((x) => fold(x.code) === needle) ?? projects.find((x) => fold(x.code).includes(needle) || fold(x.name).includes(needle)) ?? null
}

/**
 * "Send these people's documents to this client": builds the package from the
 * client's document list for the project's country, checks validity, lists what
 * is missing. Complete → sent right away (the user approved the call);
 * incomplete → waits for a person to approve it on the project's package page.
 */
// The stored preview has no signature; the final email is rendered when sent (with defineCompliance's companyName).
const o = { companyName: "" }

export const complianceSendPackageTool = defineAiTool({
    id: "staffing-compliance.send_package",
    description:
      "Sends a project team's document package (passport, A1, safety induction, VCA… as required in the project's country and by its client) to the client by email, with the stored certificate scans attached (or a time-limited ZIP link when too big). " +
      "Checks every required document's validity. If nothing is missing the email goes out at once; if something is missing or expired the package is stored as 'needs approval' with the missing list and a person approves or cancels it on the project's package page. " +
      "Default recipients: the project's saved recipients, else the client's contacts with an email. Default team: the confirmed / active team. Default language: by the client's country (LT → lt, NL/BE → nl greeting with English body, else en).",
    permission: StaffingCompliancePermissions.packageSend,
    requiresApproval: true,
    input: z.object({
      project: z.string().trim().min(1).max(100).describe("Project code (e.g. VSB-2026-12) or part of its name"),
      workers: z.array(z.string().trim().min(1).max(80)).max(60).optional().describe("Only these team members (names or parts of names); default the whole confirmed team"),
      recipients: z.array(z.string().trim().email().max(200)).max(10).optional().describe("Recipient emails; default the client's contacts"),
      language: z.enum(PACKAGE_LANGUAGES).optional().describe("lt, en or nl"),
      note: z.string().trim().max(2000).optional().describe("A short note added to the email"),
    }),
    handler: async (ctx, input) => {
      const p = await findProject(ctx, input.project)
      if (!p) return { found: false }
      const base = await buildPackageDraft(ctx, { projectId: p._id }, o)
      if (!base) return { found: false }
      let workerIds: string[] | undefined
      const unknownWorkers: string[] = []
      if (input.workers?.length) {
        workerIds = []
        for (const w of input.workers) {
          const f = fold(w)
          const m = base.candidates.find((c) => fold(c.workerName).includes(f))
          if (m) workerIds.push(m.workerId)
          else unknownWorkers.push(w)
        }
      }
      const recipients = cleanRecipients(input.recipients?.map((email) => ({ email })), ctx.sys.operationId)
      const draft = await buildPackageDraft(ctx, { projectId: p._id, workerIds, recipients, language: input.language, note: input.note }, o)
      if (!draft || !draft.members.length) return { found: true, error: "No team members to send (the project has no confirmed or active workers, or none matched).", unknownWorkers }
      if (!draft.recipients.length) return { found: true, error: "No recipients: the client has no contact with an email. Give the recipients' emails." }
      const r = await insertPackage(ctx, draft, { trigger: "ai", createdBy: actorId(ctx.actor), createdByName: `${await actorName(ctx, ctx.actor)} (DI asistentas)`, note: input.note, sendIfComplete: true })
      await recordAudit(ctx.sys, ctx.actor, {
        action: "staffing-compliance.package.create",
        targetType: "staffing_compliance_packages",
        targetId: r.packageId,
        changes: { projectId: p._id, status: r.status, members: draft.members.length, missing: draft.evaluation.missing.length, via: "ai" },
      })
      return {
        found: true,
        project: `${p.code} ${p.name}`,
        status: r.status === "queued" ? "sending (complete package)" : "needs_approval (something is missing; a person approves or cancels it on the package page)",
        recipients: draft.recipients.map((x) => x.email),
        language: draft.language,
        team: draft.members.map((m) => `${m.workerName} (${m.tradeName})`),
        missing: draft.evaluation.missing.map((g) => `${g.workerName}: ${g.documentEn ?? g.document} (${g.reason})`),
        warnings: draft.evaluation.warnings.map((g) => `${g.workerName}: ${g.documentEn ?? g.document} valid until ${g.expiresAt ?? "?"}`),
        files: draft.evaluation.fileCount,
        delivery: draft.delivery,
        ...(unknownWorkers.length ? { unknownWorkers } : {}),
        link: `/app/compliance/projects/${p._id}/package`,
      }
    },
  })

export const complianceTools = [complianceProjectReadinessTool, complianceSendPackageTool] as const
