import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * The staffing module's stable contract: workers, clients, projects,
 * assignments and the catalogs (trades, certificate types). Permission and
 * subrole IDs never change meaning: add new ones, deprecate old ones.
 *
 * Feature areas built on top (teams, timesheets, invoicing, logistics,
 * compliance) are separate modules with their own manifests under
 * `src/<area>/manifest.ts`; they may declare `dependsOn: ["staffing"]`
 * (which never grants staffing permissions).
 */
export const staffing = defineModule({
  id: "staffing",
  kind: "business",
  name: "Darbuotojai ir projektai",
  description: "Darbuotojai, jų kvalifikacijos ir pažymėjimai, klientai, projektai ir darbuotojų priskyrimai projektams",
  permissions: [
    { id: "staffing:worker:read", name: "Matyti darbuotojus", description: "Peržiūrėti darbuotojų sąrašą, korteles ir pažymėjimus" },
    { id: "staffing:worker:create", name: "Kurti darbuotojus", description: "Pridėti naujus darbuotojus" },
    { id: "staffing:worker:update", name: "Redaguoti darbuotojus", description: "Keisti darbuotojų duomenis, kvalifikacijas ir pažymėjimus" },
    { id: "staffing:worker:delete", name: "Šalinti darbuotojus", description: "Pašalinti darbuotojus be priskyrimų ir jų pažymėjimus" },
    { id: "staffing:client:read", name: "Matyti klientus", description: "Peržiūrėti klientų sąrašą ir kortelę" },
    { id: "staffing:client:create", name: "Kurti klientus", description: "Pridėti naujus klientus" },
    { id: "staffing:client:update", name: "Redaguoti klientus", description: "Keisti klientų duomenis, kontaktus ir įkainius" },
    { id: "staffing:client:delete", name: "Šalinti klientus", description: "Pašalinti klientus be projektų" },
    { id: "staffing:project:read", name: "Matyti projektus", description: "Peržiūrėti projektus ir jų komandas" },
    { id: "staffing:project:create", name: "Kurti projektus", description: "Pridėti naujus projektus" },
    { id: "staffing:project:update", name: "Redaguoti projektus", description: "Keisti projektų duomenis, būseną ir įkainius" },
    { id: "staffing:project:delete", name: "Šalinti projektus", description: "Pašalinti projektus be priskyrimų" },
    { id: "staffing:assignment:read", name: "Matyti priskyrimus", description: "Matyti, kas kada dirba kuriame projekte" },
    { id: "staffing:assignment:create", name: "Priskirti darbuotojus", description: "Priskirti darbuotojus projektams" },
    { id: "staffing:assignment:update", name: "Keisti priskyrimus", description: "Keisti priskyrimų datas, būseną ir specialybę" },
    { id: "staffing:assignment:delete", name: "Šalinti priskyrimus", description: "Pašalinti klaidingai sukurtus priskyrimus" },
    { id: "staffing:catalog:manage", name: "Valdyti katalogus", description: "Kurti ir keisti specialybes ir pažymėjimų tipus" },
  ],
  initialSubroles: [
    {
      id: "staffing:viewer",
      name: "Darbuotojų ir projektų skaitytojas",
      description: "Gali peržiūrėti darbuotojus, klientus, projektus ir priskyrimus",
      permissions: ["staffing:worker:read", "staffing:client:read", "staffing:project:read", "staffing:assignment:read"],
    },
    {
      id: "staffing:planner",
      name: "Planuotojas",
      description: "Tvarko darbuotojus ir jų pažymėjimus, kuria projektus ir formuoja komandas",
      permissions: [
        "staffing:worker:read",
        "staffing:worker:create",
        "staffing:worker:update",
        "staffing:client:read",
        "staffing:project:read",
        "staffing:project:create",
        "staffing:project:update",
        "staffing:assignment:read",
        "staffing:assignment:create",
        "staffing:assignment:update",
        "staffing:assignment:delete",
      ],
    },
    {
      id: "staffing:admin",
      name: "Darbuotojų ir projektų administratorius",
      description: "Viskas, plius klientai, šalinimas ir katalogai",
      permissions: [
        "staffing:worker:read",
        "staffing:worker:create",
        "staffing:worker:update",
        "staffing:worker:delete",
        "staffing:client:read",
        "staffing:client:create",
        "staffing:client:update",
        "staffing:client:delete",
        "staffing:project:read",
        "staffing:project:create",
        "staffing:project:update",
        "staffing:project:delete",
        "staffing:assignment:read",
        "staffing:assignment:create",
        "staffing:assignment:update",
        "staffing:assignment:delete",
        "staffing:catalog:manage",
      ],
    },
  ],
})

export const StaffingPermissions = {
  workerRead: "staffing:worker:read",
  workerCreate: "staffing:worker:create",
  workerUpdate: "staffing:worker:update",
  workerDelete: "staffing:worker:delete",
  clientRead: "staffing:client:read",
  clientCreate: "staffing:client:create",
  clientUpdate: "staffing:client:update",
  clientDelete: "staffing:client:delete",
  projectRead: "staffing:project:read",
  projectCreate: "staffing:project:create",
  projectUpdate: "staffing:project:update",
  projectDelete: "staffing:project:delete",
  assignmentRead: "staffing:assignment:read",
  assignmentCreate: "staffing:assignment:create",
  assignmentUpdate: "staffing:assignment:update",
  assignmentDelete: "staffing:assignment:delete",
  catalogManage: "staffing:catalog:manage",
} as const satisfies Record<string, PermissionOf<typeof staffing>>

export type StaffingPermission = (typeof StaffingPermissions)[keyof typeof StaffingPermissions]

export const STAFFING_MODULE_ID = "staffing"
