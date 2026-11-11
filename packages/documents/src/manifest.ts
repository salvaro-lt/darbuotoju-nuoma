import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * The documents module's stable contract. Permission, subrole and flag IDs
 * never change meaning: add new ones, deprecate old ones.
 */
export const documents = defineModule({
  id: "documents",
  kind: "business",
  name: "Dokumentai",
  description: "Dokumentų archyvas su žymomis, korespondentais, tipais ir paieška; dokumentų pasirašymas el. parašu",
  permissions: [
    { id: "documents:document:read", name: "Skaityti", description: "Peržiūrėti ir atsisiųsti archyvo dokumentus" },
    { id: "documents:document:create", name: "Įkelti", description: "Įkelti dokumentus į archyvą" },
    { id: "documents:document:update", name: "Redaguoti", description: "Keisti dokumentų pavadinimą, datą, žymas, korespondentą, tipą ir laukus" },
    { id: "documents:document:delete", name: "Šalinti", description: "Perkelti dokumentus į šiukšlinę ir atkurti" },
    { id: "documents:document:share", name: "Bendrinti", description: "Bendrinti dokumentą su rolėmis ir naudotojais" },
    {
      id: "documents:document:all",
      name: "Matyti visus dokumentus",
      description: "Matyti visus dokumentus ir žymas, net ribotos prieigos (pvz. el. laiškų archyvą)",
    },
    {
      id: "documents:label:manage",
      name: "Valdyti žymas",
      description: "Kurti ir keisti žymas, korespondentus, tipus, savus laukus, atitikimo taisykles ir bendrus vaizdus",
    },
    { id: "documents:signing:read", name: "Matyti pasirašymus", description: "Peržiūrėti pasirašymo šablonus, siuntimus ir audito pėdsaką" },
    { id: "documents:signing:send", name: "Siųsti pasirašyti", description: "Siųsti dokumentą pasirašyti ir atšaukti siuntimą" },
    { id: "documents:template:manage", name: "Valdyti šablonus", description: "Kurti ir keisti pasirašymo šablonus ir jų laukus" },
  ],
  initialSubroles: [
    {
      id: "documents:viewer",
      name: "Dokumentų skaitytojas",
      description: "Gali peržiūrėti archyvą ir pasirašymų būseną",
      permissions: ["documents:document:read", "documents:signing:read"],
    },
    {
      id: "documents:editor",
      name: "Dokumentų redaktorius",
      description: "Gali įkelti dokumentus, juos žymėti ir siųsti pasirašyti",
      permissions: [
        "documents:document:read",
        "documents:document:create",
        "documents:document:update",
        "documents:document:share",
        "documents:signing:read",
        "documents:signing:send",
      ],
    },
    {
      id: "documents:admin",
      name: "Dokumentų administratorius",
      description: "Viskas, plius šalinimas, visi (ir ribotos prieigos) dokumentai, žymų taisyklės ir pasirašymo šablonai",
      permissions: [
        "documents:document:read",
        "documents:document:create",
        "documents:document:update",
        "documents:document:delete",
        "documents:document:share",
        "documents:document:all",
        "documents:label:manage",
        "documents:signing:read",
        "documents:signing:send",
        "documents:template:manage",
      ],
    },
  ],
  featureFlags: [
    { id: "documents:signing", description: "Dokumentų pasirašymas el. parašu (šablonai, siuntimai, viešas pasirašymo puslapis)", default: true },
    { id: "documents:ai", description: "AI: skenuotų dokumentų teksto atpažinimas ir automatinis žymėjimas („auto“ taisyklės)", default: true },
  ],
})

export const DocumentsPermissions = {
  read: "documents:document:read",
  create: "documents:document:create",
  update: "documents:document:update",
  delete: "documents:document:delete",
  share: "documents:document:share",
  all: "documents:document:all",
  manageLabels: "documents:label:manage",
  signingRead: "documents:signing:read",
  signingSend: "documents:signing:send",
  manageTemplates: "documents:template:manage",
} as const satisfies Record<string, PermissionOf<typeof documents>>

export const DocumentsFlags = {
  signing: "documents:signing",
  ai: "documents:ai",
} as const

export const DOCUMENTS_MODULE_ID = "documents"
