import { defineModule, type PermissionOf } from "@digimuza/system-core/modules"

/**
 * Invoicing area of the staffing module: billable hours, invoices per client
 * and period, SitePro (B1) export, payments, debts and reminders, project
 * costs and profitability. Builds on `staffing` (clients, projects, trades).
 */
export const staffingInvoicing = defineModule({
  id: "staffing-invoicing",
  kind: "business",
  name: "Sąskaitos ir pelningumas",
  description: "Sąskaitos iš patvirtintų tabelių, uždaryto proceso grandinė, eksportas į SitePro, apmokėjimai ir priminimai, pirkimo sąskaitų tvirtinimas, pelningumas pagal projektus, klientus ir darbuotojus",
  dependsOn: ["staffing"],
  permissions: [
    { id: "staffing-invoicing:invoice:read", name: "Matyti sąskaitas", description: "Peržiūrėti sąskaitas, apmokėjimus, skolas ir darbo valandas" },
    { id: "staffing-invoicing:invoice:manage", name: "Rengti sąskaitas", description: "Įvesti darbo valandas, kurti ir taisyti sąskaitų juodraščius, žymėti išsiųstas, siųsti priminimus" },
    { id: "staffing-invoicing:invoice:approve", name: "Tvirtinti sąskaitas", description: "Patvirtinti sąskaitą (suteikia numerį ir išrašymo datą)" },
    { id: "staffing-invoicing:payment:manage", name: "Registruoti apmokėjimus", description: "Įvesti ir šalinti gautus apmokėjimus" },
    { id: "staffing-invoicing:cost:manage", name: "Valdyti projektų sąnaudas", description: "Įvesti ir šalinti projektų sąnaudas" },
    { id: "staffing-invoicing:profit:read", name: "Matyti pelningumą", description: "Peržiūrėti pelningumą pagal projektus, klientus ir darbuotojus, darbuotojų valandinius kaštus" },
    { id: "staffing-invoicing:purchase:approve", name: "Tvirtinti pirkimo sąskaitas", description: "Patvirtinti arba atmesti tiekėjų sąskaitas prieš jas perduodant buhalterijai (SitePro)" },
  ],
  initialSubroles: [
    {
      id: "staffing-invoicing:viewer",
      name: "Sąskaitų skaitytojas",
      description: "Gali peržiūrėti sąskaitas, apmokėjimus ir skolas",
      permissions: ["staffing-invoicing:invoice:read"],
    },
    {
      id: "staffing-invoicing:accountant",
      name: "Buhalteris",
      description: "Rengia sąskaitas, registruoja apmokėjimus ir sąnaudas, siunčia priminimus",
      permissions: ["staffing-invoicing:invoice:read", "staffing-invoicing:invoice:manage", "staffing-invoicing:payment:manage", "staffing-invoicing:cost:manage", "staffing-invoicing:profit:read"],
    },
    {
      id: "staffing-invoicing:director",
      name: "Direktorius (sąskaitos)",
      description: "Viskas, plius sąskaitų ir pirkimo sąskaitų tvirtinimas",
      permissions: [
        "staffing-invoicing:invoice:read",
        "staffing-invoicing:invoice:manage",
        "staffing-invoicing:invoice:approve",
        "staffing-invoicing:payment:manage",
        "staffing-invoicing:cost:manage",
        "staffing-invoicing:profit:read",
        "staffing-invoicing:purchase:approve",
      ],
    },
  ],
})

export const StaffingInvoicingPermissions = {
  invoiceRead: "staffing-invoicing:invoice:read",
  invoiceManage: "staffing-invoicing:invoice:manage",
  invoiceApprove: "staffing-invoicing:invoice:approve",
  paymentManage: "staffing-invoicing:payment:manage",
  costManage: "staffing-invoicing:cost:manage",
  profitRead: "staffing-invoicing:profit:read",
  purchaseApprove: "staffing-invoicing:purchase:approve",
} as const satisfies Record<string, PermissionOf<typeof staffingInvoicing>>

export type StaffingInvoicingPermission = (typeof StaffingInvoicingPermissions)[keyof typeof StaffingInvoicingPermissions]

export const STAFFING_INVOICING_MODULE_ID = "staffing-invoicing"
