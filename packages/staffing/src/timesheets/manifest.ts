import { defineModule, defineNotificationType, type PermissionOf } from "@digimuza/system-core/modules"

/** To holders of `client:manage`: a client timesheet came in by email and waits for review. Params `{ projectCode, from, fileName, rows }`. */
export const timesheetsSheetReceived = defineNotificationType({
  id: "staffing-timesheets.client_sheet_received",
  moduleId: "staffing-timesheets",
  defaultChannels: { inApp: true, email: false },
  description: "Klientų tabelis gautas el. paštu ir laukia peržiūros",
  params: ["projectCode", "from", "fileName", "rows"],
})

/** To holders of `client:manage`: a worker marked a day "nesutinku" on the personal link. Params `{ worker, projectCode, date, comment }`. */
export const timesheetsWorkerDisagrees = defineNotificationType({
  id: "staffing-timesheets.worker_disagrees",
  moduleId: "staffing-timesheets",
  defaultChannels: { inApp: true, email: false },
  description: "Darbuotojas nesutinka su kliento tabeliu",
  params: ["worker", "projectCode", "date", "comment"],
})

/**
 * Timesheets ("Tabeliai"): own daily hours per assignment entered by the site
 * coordinator, week approval (locks hours for invoicing), client timesheet
 * import and reconciliation, late client timesheet reminders and the
 * subcontractor timesheet export. Depends on the staffing base.
 */
export const staffingTimesheets = defineModule({
  id: "staffing-timesheets",
  kind: "business",
  name: "Tabeliai ir valandų sutikrinimas",
  description: "Dirbtos valandos pagal projektus, savaičių tvirtinimas, klientų tabelių importas ir sutikrinimas, priminimai, subrangovų tabeliai",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-timesheets:entry:read", name: "Matyti tabelius", description: "Peržiūrėti dirbtas valandas, klientų tabelius ir sutikrinimą" },
    { id: "staffing-timesheets:entry:write", name: "Pildyti valandas", description: "Įvesti ir taisyti darbuotojų dirbtas valandas nepatvirtintoms savaitėms" },
    { id: "staffing-timesheets:week:approve", name: "Tvirtinti savaites", description: "Patvirtinti savaitės valandas (užrakina sąskaitoms) ir atrakinti" },
    { id: "staffing-timesheets:client:manage", name: "Tvarkyti klientų tabelius", description: "Įkelti klientų tabelius, spręsti neatitikimus, siųsti priminimus ir keisti tabelių grafiką" },
    { id: "staffing-timesheets:subcontractor:export", name: "Subrangovų tabeliai", description: "Atsisiųsti subrangovų darbuotojų patvirtintas valandas" },
  ],
  initialSubroles: [
    {
      id: "staffing-timesheets:viewer",
      name: "Tabelių skaitytojas",
      description: "Mato valandas, klientų tabelius ir sutikrinimą",
      permissions: ["staffing-timesheets:entry:read"],
    },
    {
      id: "staffing-timesheets:coordinator",
      name: "Objekto koordinatorius",
      description: "Pildo valandas, įkelia klientų tabelius ir sprendžia neatitikimus",
      permissions: ["staffing-timesheets:entry:read", "staffing-timesheets:entry:write", "staffing-timesheets:client:manage"],
    },
    {
      id: "staffing-timesheets:manager",
      name: "Tabelių vadovas",
      description: "Viskas, plius savaičių tvirtinimas ir subrangovų tabeliai",
      permissions: ["staffing-timesheets:entry:read", "staffing-timesheets:entry:write", "staffing-timesheets:week:approve", "staffing-timesheets:client:manage", "staffing-timesheets:subcontractor:export"],
    },
  ],
  notificationTypes: [timesheetsSheetReceived, timesheetsWorkerDisagrees],
})

export const StaffingTimesheetsPermissions = {
  read: "staffing-timesheets:entry:read",
  write: "staffing-timesheets:entry:write",
  approve: "staffing-timesheets:week:approve",
  clientManage: "staffing-timesheets:client:manage",
  export: "staffing-timesheets:subcontractor:export",
} as const satisfies Record<string, PermissionOf<typeof staffingTimesheets>>

export const STAFFING_TIMESHEETS_MODULE_ID = "staffing-timesheets"
