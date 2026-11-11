import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * The CRM module's stable contract. Permission, subrole and flag IDs never
 * change meaning: add new ones, deprecate old ones.
 */
export const crm = defineModule({
  id: "crm",
  kind: "business",
  name: "CRM",
  description: "Klientų valdymas: konfigūruojami objektai, laukai, įrašai, vaizdai ir pastabos",
  permissions: [
    { id: "crm:record:read", name: "Skaityti", description: "Peržiūrėti CRM įrašus, jų laukus ir vaizdus" },
    { id: "crm:record:create", name: "Kurti", description: "Sukurti CRM įrašą" },
    { id: "crm:record:update", name: "Redaguoti", description: "Keisti CRM įrašų laukus" },
    { id: "crm:record:delete", name: "Archyvuoti", description: "Archyvuoti ir atkurti CRM įrašus, trinti kitų pastabas" },
    { id: "crm:note:create", name: "Rašyti pastabas", description: "Pridėti pastabas prie įrašų ir trinti savo pastabas" },
    { id: "crm:view:manage", name: "Valdyti vaizdus", description: "Kurti, keisti ir trinti bendrus lentelės ir kanban vaizdus" },
    {
      id: "crm:schema:manage",
      name: "Valdyti duomenų modelį",
      description: "Kurti ir keisti objektus bei laukus, diegti standartinį modelį",
      humanOnly: true,
    },
  ],
  initialSubroles: [
    { id: "crm:viewer", name: "CRM skaitytojas", description: "Gali peržiūrėti įrašus", permissions: ["crm:record:read"] },
    {
      id: "crm:member",
      name: "CRM narys",
      description: "Gali kurti ir redaguoti įrašus, rašyti pastabas",
      permissions: ["crm:record:read", "crm:record:create", "crm:record:update", "crm:note:create"],
    },
    {
      id: "crm:manager",
      name: "CRM vadovas",
      description: "Viskas, ką gali narys, plius archyvavimas ir bendri vaizdai",
      permissions: ["crm:record:read", "crm:record:create", "crm:record:update", "crm:record:delete", "crm:note:create", "crm:view:manage"],
    },
    {
      id: "crm:admin",
      name: "CRM administratorius",
      description: "Viskas, plius duomenų modelio (objektų ir laukų) keitimas",
      permissions: [
        "crm:record:read",
        "crm:record:create",
        "crm:record:update",
        "crm:record:delete",
        "crm:note:create",
        "crm:view:manage",
        "crm:schema:manage",
      ],
    },
  ],
  featureFlags: [
    { id: "crm:custom-objects", description: "Leisti kurti savus objektus (be standartinių įmonių, žmonių, sandorių)", default: true },
    { id: "crm:custom-fields", description: "Leisti pridėti savus laukus prie objektų", default: true },
    { id: "crm:kanban", description: "Kanban vaizdai pagal pasirinkimo lauką (pvz. sandorio etapą)", default: true },
  ],
})

export const CrmPermissions = {
  read: "crm:record:read",
  create: "crm:record:create",
  update: "crm:record:update",
  delete: "crm:record:delete",
  note: "crm:note:create",
  manageViews: "crm:view:manage",
  manageSchema: "crm:schema:manage",
} as const satisfies Record<string, PermissionOf<typeof crm>>

export const CrmFlags = {
  customObjects: "crm:custom-objects",
  customFields: "crm:custom-fields",
  kanban: "crm:kanban",
} as const
