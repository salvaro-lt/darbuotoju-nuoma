// AI tools of the "teams" area. Read-only: proposes a team, writes nothing.
import { defineAiTool } from "@digimuza/system-core/ai"
import { z } from "zod"
import { loadCatalog } from "../operations"
import { fold, isIsoDate } from "../pure"
import { readerOf, type ClientId } from "../shared"
import { describeGap } from "./matching"
import { StaffingTeamsPermissions } from "./manifest"
import { buildProposal } from "./operations"

const date = z.string().refine(isIsoDate, "YYYY-MM-DD")

export const teamsProposeTeamTool = defineAiTool({
  id: "staffing-teams.propose_team",
  description:
    "Drafts a team for a client request: for each trade and head count, ranks the workers free for the whole period (trade level, valid mandatory and required certificates on the start date, driving licence, earlier work for the same client, language) and returns the proposed people, alternatives and what is missing (people to find through a subcontractor, certificates, drivers). Writes nothing.",
  permission: StaffingTeamsPermissions.requestRead,
  input: z.object({
    from: date.describe("Start date, YYYY-MM-DD"),
    to: date.optional().describe("End date, YYYY-MM-DD"),
    client: z.string().trim().max(120).optional().describe("Client name or code (for the earlier-work bonus)"),
    lines: z
      .array(
        z.object({
          trade: z.string().trim().min(1).max(60).describe("Trade code or name, e.g. WELD-MAG or suvirintojas"),
          count: z.number().int().min(1).max(60),
          drivers: z.number().int().min(0).max(60).optional(),
          certificates: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe("Required certificate type names besides the mandatory ones"),
        }),
      )
      .min(1)
      .max(10),
    languages: z.array(z.string().trim().length(2)).max(5).optional().describe("Wanted languages, ISO-639-1"),
  }),
  handler: async (ctx, input) => {
    const db = readerOf(ctx)
    const catalog = await loadCatalog(ctx)
    const unknown: string[] = []
    const lines = input.lines.flatMap((l) => {
      const n = fold(l.trade)
      const trade = catalog.tradeList.find((t) => fold(t.code) === n) ?? catalog.tradeList.find((t) => fold(t.nameLt).includes(n) || fold(t.nameEn).includes(n))
      if (!trade) {
        unknown.push(l.trade)
        return []
      }
      const certificateTypeIds = (l.certificates ?? []).flatMap((c) => {
        const f = fold(c)
        const type = catalog.certificateTypeList.find((t) => fold(t.name).includes(f) || fold(t.nameEn ?? "").includes(f))
        if (!type) unknown.push(c)
        return type ? [type._id] : []
      })
      return [{ tradeId: trade._id, count: l.count, drivers: Math.min(l.drivers ?? 0, l.count), certificateTypeIds }]
    })
    if (!lines.length) return { error: "No trade matches the given names.", unknown }
    let clientId: ClientId | undefined
    if (input.client) {
      const n = fold(input.client)
      clientId = (await db.query("staffing_clients").take(500)).find((c) => fold(c.code) === n || fold(c.name).includes(n))?._id
    }
    const p = await buildProposal(ctx, { clientId: clientId ?? ("" as ClientId), startDate: input.from, endDate: input.to, lines, languages: input.languages ?? [] })
    const tradeName = (id: string) => catalog.trades.get(id)?.nameEn ?? "?"
    const certName = (id: string) => catalog.certificateTypes.get(id)?.nameEn ?? catalog.certificateTypes.get(id)?.name ?? "?"
    return {
      lines: lines.map((l, i) => ({
        trade: tradeName(l.tradeId),
        needed: l.count,
        proposed: p.selection
          .filter((s) => s.lineIndex === i)
          .map((s) => {
            const r = p.ranked[i]!.find((x) => x.workerId === s.workerId)!
            return { name: r.name, level: r.level, driver: s.isDriver, earlierJobsForClient: r.previousClientAssignments, warnings: r.warnings.map((w) => w.code), link: `/app/staffing/workers/${r.workerId}` }
          }),
        alternatives: p.ranked[i]!.filter((r) => !p.selection.some((s) => s.workerId === r.workerId))
          .slice(0, 5)
          .map((r) => ({ name: r.name, level: r.level, fit: r.eligible, warnings: r.warnings.map((w) => w.code) })),
      })),
      missing: p.gaps.map((g) => describeGap(g, { trade: tradeName, certificate: certName }, "en")),
      ...(unknown.length ? { unknown } : {}),
      hint: "To save it as a request and confirm the team, use the Komandos page (/app/teams).",
    }
  },
})

export const teamsTools = [teamsProposeTeamTool] as const
