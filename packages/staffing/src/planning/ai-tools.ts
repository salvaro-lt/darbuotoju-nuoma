// AI tools of the "planning" area. Read-only.
import { defineAiTool } from "@digimuza/system-core/ai"
import { z } from "zod"
import { isIsoDate, todayIso } from "../pure"
import { capacityFor } from "./functions"
import { StaffingPlanningPermissions } from "./manifest"
import { loadCatalog, tradesForText } from "./operations"
import { nextMonday } from "./pure"

const date = z.string().refine(isIsoDate, "YYYY-MM-DD")

export const planningCapacityTool = defineAiTool({
  id: "staffing-planning.capacity",
  description:
    "Answers 'do we have N people of a trade from a date?' (e.g. 'Ar turime 20 suvirintojų nuo pirmadienio?'). Counts own workers in reserve, workers freed by projects ending before the date, workers back from rest, and subcontractor capacity (declared or registered), and the shortfall; lists who becomes free within two weeks after. 'suvirintojai' / 'welders' means every welding trade. Returns a short internal summary and a reply for the client. Writes nothing.",
  permission: StaffingPlanningPermissions.boardRead,
  input: z.object({
    trade: z.string().trim().min(2).max(60).describe("Trade code or name, e.g. WELD-MAG, suvirintojai, pipe fitter"),
    count: z.number().int().min(1).max(500),
    from: date.optional().describe("First day, YYYY-MM-DD. Default: next Monday"),
    to: date.optional().describe("Last day, YYYY-MM-DD. Default: 4 weeks from `from`"),
    language: z.enum(["lt", "en"]).optional().describe("Reply language; default lt"),
  }),
  handler: async (ctx, input) => {
    const catalog = await loadCatalog(ctx)
    const tradeIds = tradesForText(catalog, input.trade)
    if (!tradeIds.length) return { error: `No trade matches "${input.trade}".`, trades: catalog.tradeList.map((t) => `${t.code} (${t.nameEn})`) }
    const from = input.from ?? nextMonday(todayIso())
    const a = await capacityFor(ctx, { tradeIds, count: input.count, from, to: input.to })
    const lang = input.language ?? "lt"
    const names = (ps: { name: string; date: string | null; label: string | null }[]) => ps.map((p) => [p.name, p.label, p.date].filter(Boolean).join(" · "))
    return {
      trades: tradeIds.map((id) => catalog.trades.get(id)?.code ?? "?"),
      from: a.question.from,
      to: a.question.to,
      asked: a.question.count,
      available: a.total,
      shortfall: a.shortfall,
      ownReserve: names(a.ownFree),
      freedByEndingProjects: names(a.freedByEnding),
      backFromRest: names(a.backFromRest),
      subcontractors: a.subcontractors.map((s) => ({ name: s.name, count: s.count, declared: s.declared, registeredFree: s.registered })),
      freeWithinTwoWeeksAfter: names(a.freedLater),
      summary: a.reply[lang].internal,
      replyToClient: a.reply[lang].client,
      link: "/app/planning",
    }
  },
})

export const planningTools = [planningCapacityTool] as const
