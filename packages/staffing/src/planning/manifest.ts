import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * Staffing area "planning" (Planavimas): two-level planning, projects and
 * every worker's own timeline. Worker rotation (rest at home, unavailable,
 * available from), the weekly board (free people by trade against open
 * requests), the quick capacity answer, subcontractor capacity, per-client
 * team composition rules and per-client feedback on workers. Depends on
 * `staffing`; the teams engine reads its rules, capacities and feedback.
 */
export const staffingPlanning = defineModule({
  id: "staffing-planning",
  kind: "business",
  name: "Planavimas",
  description: "Savaitinis planavimas: laisvi žmonės pagal specialybę prieš poreikį, darbuotojų poilsis ir rotacija, subrangos pajėgumai, komandų taisyklės ir pastabos apie darbuotojus pas klientus",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-planning:board:read", name: "Matyti planavimą", description: "Savaitinė planavimo lentelė, greitas atsakymas apie pajėgumus, darbuotojų būsena ir istorija pas klientus" },
    { id: "staffing-planning:availability:write", name: "Žymėti poilsį ir nebuvimą", description: "Pridėti ar pašalinti darbuotojo poilsio, nebuvimo ar „galimas nuo“ laikotarpį" },
    { id: "staffing-planning:feedback:write", name: "Rašyti pastabas apie darbuotojus", description: "Pažymėti darbuotoją tinkamu ar netinkamu konkrečiam klientui" },
    { id: "staffing-planning:settings:write", name: "Keisti planavimo nustatymus", description: "Subrangovų pajėgumai ir klientų komandų taisyklės" },
  ],
  initialSubroles: [
    {
      id: "staffing-planning:viewer",
      name: "Planavimo skaitytojas",
      description: "Mato planavimo lentelę ir pajėgumus",
      permissions: ["staffing-planning:board:read"],
    },
    {
      id: "staffing-planning:planner",
      name: "Planuotojas",
      description: "Planuoja rotaciją, žymi poilsį, rašo pastabas apie darbuotojus, keičia subrangos pajėgumus ir komandų taisykles",
      permissions: ["staffing-planning:board:read", "staffing-planning:availability:write", "staffing-planning:feedback:write", "staffing-planning:settings:write"],
    },
  ],
})

export const StaffingPlanningPermissions = {
  boardRead: "staffing-planning:board:read",
  availabilityWrite: "staffing-planning:availability:write",
  feedbackWrite: "staffing-planning:feedback:write",
  settingsWrite: "staffing-planning:settings:write",
} as const satisfies Record<string, PermissionOf<typeof staffingPlanning>>

export const STAFFING_PLANNING_MODULE_ID = "staffing-planning"
