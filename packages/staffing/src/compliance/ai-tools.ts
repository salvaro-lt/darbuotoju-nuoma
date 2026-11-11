// AI tool of the compliance area (read-only).
import { defineAiTool } from "@digimuza/system-core/ai"
import { z } from "zod"
import { fold } from "../pure"
import { StaffingCompliancePermissions } from "./manifest"
import { complianceReader, projectReadiness } from "./operations"

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

export const complianceTools = [complianceProjectReadinessTool] as const
