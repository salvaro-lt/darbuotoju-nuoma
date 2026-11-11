import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * Staffing area "teams" (komandų formavimas): client team requests, the
 * matching engine that drafts a team, the planner's confirmation into
 * assignments, and the answer-to-client draft. Depends on `staffing` (which
 * never grants its permissions): confirming a team also needs
 * `staffing:assignment:create`.
 */
export const staffingTeams = defineModule({
  id: "staffing-teams",
  kind: "business",
  name: "Komandų formavimas",
  description: "Kliento poreikiai, automatiškai sudaromas komandos pasiūlymas, komandos patvirtinimas ir atsakymo klientui juodraštis",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-teams:request:read", name: "Matyti poreikius", description: "Peržiūrėti klientų poreikius ir komandų pasiūlymus" },
    { id: "staffing-teams:request:write", name: "Kurti ir keisti poreikius", description: "Registruoti poreikius, keisti komandos juodraštį, atšaukti poreikį" },
    { id: "staffing-teams:team:confirm", name: "Tvirtinti komandas", description: "Paversti komandos pasiūlymą priskyrimais projektui" },
    { id: "staffing-teams:draft:send", name: "Ruošti atsakymą klientui", description: "Paprašyti AI paruošti atsakymo klientui juodraštį (siunčiamas projekto vadovui)" },
  ],
  initialSubroles: [
    {
      id: "staffing-teams:viewer",
      name: "Komandų pasiūlymų skaitytojas",
      description: "Mato poreikius ir komandų pasiūlymus",
      permissions: ["staffing-teams:request:read"],
    },
    {
      id: "staffing-teams:planner",
      name: "Komandų planuotojas",
      description: "Registruoja poreikius, formuoja ir tvirtina komandas, ruošia atsakymus klientams",
      permissions: ["staffing-teams:request:read", "staffing-teams:request:write", "staffing-teams:team:confirm", "staffing-teams:draft:send"],
    },
  ],
})

export const StaffingTeamsPermissions = {
  requestRead: "staffing-teams:request:read",
  requestWrite: "staffing-teams:request:write",
  teamConfirm: "staffing-teams:team:confirm",
  draftSend: "staffing-teams:draft:send",
} as const satisfies Record<string, PermissionOf<typeof staffingTeams>>

export const STAFFING_TEAMS_MODULE_ID = "staffing-teams"
