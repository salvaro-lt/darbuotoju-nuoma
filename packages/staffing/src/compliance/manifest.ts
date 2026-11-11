import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * Staffing area "compliance" (Darbuotojų dokumentai ir sutartys): document
 * requirements per country and client, project readiness, expiry radar and
 * digest, contract templates and generated contracts, the client document
 * package. Depends on `staffing` (never grants its permissions).
 */
export const staffingCompliance = defineModule({
  id: "staffing-compliance",
  kind: "business",
  name: "Darbuotojų dokumentai ir sutartys",
  description: "Reikalingi dokumentai pagal šalį ir klientą, komandos pasirengimas projektui, baigiantys galioti pažymėjimai, sutarčių šablonai ir dokumentų paketas klientui",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-compliance:readiness:read", name: "Matyti dokumentų pasirengimą", description: "Matyti reikalavimus, pasirengimo matricą, baigiančius galioti pažymėjimus ir dokumentų paketą" },
    { id: "staffing-compliance:requirement:manage", name: "Valdyti dokumentų reikalavimus", description: "Nustatyti, kokių dokumentų reikia kiekvienoje šalyje ir kiekvienam klientui" },
    { id: "staffing-compliance:digest:send", name: "Siųsti galiojimo suvestinę", description: "Išsiųsti baigiančių galioti dokumentų suvestinę planuotojui" },
    { id: "staffing-compliance:contract:read", name: "Matyti sutartis", description: "Matyti sutarčių šablonus ir sugeneruotas sutartis" },
    { id: "staffing-compliance:contract:create", name: "Generuoti sutartis", description: "Generuoti sutartis ir įsakymus darbuotojams iš šablonų" },
    { id: "staffing-compliance:template:manage", name: "Valdyti sutarčių šablonus", description: "Kurti, keisti ir šalinti sutarčių šablonus, šalinti sutartis" },
    { id: "staffing-compliance:package:send", name: "Siųsti dokumentų paketą klientui", description: "Paruošti, patvirtinti ir siųsti komandos dokumentų paketą klientui el. paštu, kurti atsisiuntimo nuorodas" },
  ],
  initialSubroles: [
    {
      id: "staffing-compliance:viewer",
      name: "Dokumentų skaitytojas",
      description: "Mato pasirengimą, baigiančius galioti dokumentus ir sutartis",
      permissions: ["staffing-compliance:readiness:read", "staffing-compliance:contract:read"],
    },
    {
      id: "staffing-compliance:planner",
      name: "Dokumentų planuotojas",
      description: "Mato pasirengimą, siunčia suvestines ir dokumentų paketus klientams, generuoja sutartis",
      permissions: ["staffing-compliance:readiness:read", "staffing-compliance:digest:send", "staffing-compliance:contract:read", "staffing-compliance:contract:create", "staffing-compliance:package:send"],
    },
    {
      id: "staffing-compliance:admin",
      name: "Dokumentų administratorius",
      description: "Viskas, plius reikalavimai ir sutarčių šablonai",
      permissions: [
        "staffing-compliance:readiness:read",
        "staffing-compliance:requirement:manage",
        "staffing-compliance:digest:send",
        "staffing-compliance:contract:read",
        "staffing-compliance:contract:create",
        "staffing-compliance:template:manage",
        "staffing-compliance:package:send",
      ],
    },
  ],
})

export const StaffingCompliancePermissions = {
  readinessRead: "staffing-compliance:readiness:read",
  requirementManage: "staffing-compliance:requirement:manage",
  digestSend: "staffing-compliance:digest:send",
  contractRead: "staffing-compliance:contract:read",
  contractCreate: "staffing-compliance:contract:create",
  templateManage: "staffing-compliance:template:manage",
  packageSend: "staffing-compliance:package:send",
} as const satisfies Record<string, PermissionOf<typeof staffingCompliance>>

export const STAFFING_COMPLIANCE_MODULE_ID = "staffing-compliance"
