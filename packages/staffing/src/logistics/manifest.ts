import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * Logistics area of staffing: accommodation, vehicles, travel legs and
 * workwear for a project's team, the computed "who, where, from when to when"
 * plan and its warnings. Own module; reads the staffing base's projects,
 * workers and assignments (never writes them).
 */
export const staffingLogistics = defineModule({
  id: "staffing-logistics",
  kind: "business",
  name: "Apgyvendinimas ir transportas",
  description: "Apgyvendinimas, transportas, vairuotojai, kelionės ir darbo rūbai projektų komandoms; automatinis planas ir įspėjimai",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-logistics:plan:read", name: "Matyti logistikos planą", description: "Peržiūrėti apgyvendinimą, transportą, keliones, darbo rūbus ir įspėjimus" },
    { id: "staffing-logistics:plan:manage", name: "Tvarkyti logistiką", description: "Kurti ir keisti apgyvendinimą, transportą, keliones, paskirstyti lovas ir vietas, siųsti įspėjimus" },
  ],
  initialSubroles: [
    { id: "staffing-logistics:viewer", name: "Logistikos skaitytojas", description: "Gali peržiūrėti logistikos planą ir įspėjimus", permissions: ["staffing-logistics:plan:read"] },
    {
      id: "staffing-logistics:coordinator",
      name: "Koordinatorius",
      description: "Planuoja apgyvendinimą, transportą, keliones ir darbo rūbus",
      permissions: ["staffing-logistics:plan:read", "staffing-logistics:plan:manage"],
    },
  ],
})

export const StaffingLogisticsPermissions = {
  planRead: "staffing-logistics:plan:read",
  planManage: "staffing-logistics:plan:manage",
} as const satisfies Record<string, PermissionOf<typeof staffingLogistics>>

export const STAFFING_LOGISTICS_MODULE_ID = "staffing-logistics"
