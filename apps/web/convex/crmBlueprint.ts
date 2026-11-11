// CRM data model for the staffing business (audit: "Kelias nuo užklausos iki pinigų").
// Sales side only: client companies, their contacts and incoming client requests
// (up to ~50 a month). Workers, projects and assignments live in @digimuza/staffing.
//
// Additive: `crm:_applyBlueprint` creates missing objects/fields; admins' UI
// changes are never overwritten. New keys only, so it also applies on top of
// a deployment that already has the standard blueprint.
import { extendBlueprint, standardBlueprint, type BlueprintField } from "@digimuza/crm"

const sel = (options: [string, string, string][]) => ({
  options: options.map(([value, label, color]) => ({ value, label, color: color as "gray" })),
})

const companyFields: BlueprintField[] = [
  {
    key: "sector",
    label: "Sektorius",
    type: "select",
    settings: sel([
      ["shipbuilding", "Laivų statyba", "blue"],
      ["steel", "Metalo konstrukcijos", "orange"],
      ["industrial", "Pramonės projektai", "purple"],
      ["energy", "Energetika", "teal"],
      ["other", "Kita", "gray"],
    ]),
  },
  { key: "country", label: "Šalis", type: "text", settings: { maxLength: 60 } },
  {
    key: "clientStatus",
    label: "Būsena",
    type: "select",
    settings: sel([
      ["prospect", "Potencialus", "gray"],
      ["active", "Aktyvus klientas", "green"],
      ["recurring", "Tęstinis", "teal"],
      ["paused", "Neaktyvus", "yellow"],
    ]),
  },
  {
    key: "leadSource",
    label: "Iš kur atėjo",
    type: "select",
    settings: sel([
      ["referral", "Rekomendacija", "green"],
      ["fair", "Paroda", "blue"],
      ["event", "Renginys", "purple"],
      ["direct", "Tiesioginis kontaktas", "orange"],
      ["other", "Kita", "gray"],
    ]),
  },
  {
    key: "invoicingPeriod",
    label: "Sąskaitų periodiškumas",
    type: "select",
    settings: sel([
      ["weekly", "Kas savaitę", "blue"],
      ["biweekly", "Kas dvi savaites", "teal"],
      ["monthly", "Kas mėnesį", "purple"],
    ]),
  },
  { key: "paymentTermsDays", label: "Apmokėjimo terminas, d.", type: "number", settings: { decimals: 0, min: 0, max: 180 } },
  {
    key: "timesheetFormat",
    label: "Tabelio formatas",
    type: "select",
    settings: sel([
      ["excel", "Excel", "green"],
      ["pdf", "PDF", "red"],
      ["photo", "Popieriaus nuotrauka", "yellow"],
      ["portal", "Kliento sistema", "blue"],
    ]),
  },
  { key: "samePeopleWanted", label: "Nori tų pačių žmonių", type: "boolean" },
]

const personFields: BlueprintField[] = [
  {
    key: "contactRole",
    label: "Vaidmuo",
    type: "select",
    settings: sel([
      ["procurement", "Pirkimai", "blue"],
      ["site_manager", "Objekto / gamybos vadovas", "orange"],
      ["project_manager", "Projekto vadovas", "purple"],
      ["accounting", "Buhalterija (tabeliai, sąskaitos)", "green"],
      ["director", "Vadovas", "gray"],
    ]),
  },
  {
    key: "language",
    label: "Kalba",
    type: "select",
    settings: sel([
      ["lt", "Lietuvių", "green"],
      ["en", "Anglų", "blue"],
      ["nl", "Olandų", "orange"],
      ["de", "Vokiečių", "gray"],
      ["no", "Norvegų", "red"],
    ]),
  },
]

const TRADES: [string, string, string][] = [
  ["welder_mig", "Suvirintojas MIG/MAG", "orange"],
  ["welder_tig", "Suvirintojas TIG", "red"],
  ["welder_mma", "Suvirintojas MMA", "yellow"],
  ["fitter", "Montuotojas / surinkėjas", "blue"],
  ["pipefitter", "Vamzdynų montuotojas", "teal"],
  ["grinder", "Šlifuotojas", "gray"],
  ["painter", "Dažytojas", "purple"],
  ["electrician", "Elektrikas", "green"],
  ["foreman", "Brigadininkas", "pink"],
]

export const STAGES = ["new", "staffing", "proposal_sent", "confirmed", "lost"] as const

export const crmBlueprint = extendBlueprint(standardBlueprint("lt"), {
  fields: { company: companyFields, person: personFields },
  objects: [
    {
      key: "request",
      nameSingular: "Užklausa",
      namePlural: "Užklausos",
      description: "Kliento darbuotojų poreikis: nuo užklausos iki patvirtintos komandos",
      icon: "inbox",
      labelFieldKey: "name",
      fields: [
        { key: "name", label: "Pavadinimas", type: "text", required: true },
        {
          key: "stage",
          label: "Etapas",
          type: "select",
          required: true,
          settings: sel([
            ["new", "Nauja", "gray"],
            ["staffing", "Formuojama komanda", "blue"],
            ["proposal_sent", "Pasiūlymas išsiųstas", "purple"],
            ["confirmed", "Patvirtinta", "green"],
            ["lost", "Prarasta", "red"],
          ]),
        },
        { key: "company", label: "Klientas", type: "relation", settings: { objectKey: "company", inverseLabel: "Užklausos" } },
        { key: "contact", label: "Kontaktas", type: "relation", settings: { objectKey: "person", inverseLabel: "Užklausos" } },
        { key: "receivedAt", label: "Gauta", type: "date" },
        {
          key: "channel",
          label: "Kanalas",
          type: "select",
          settings: sel([
            ["email", "El. paštas", "blue"],
            ["phone", "Skambutis", "green"],
            ["message", "Žinutė", "teal"],
            ["fair", "Paroda / renginys", "purple"],
          ]),
        },
        { key: "trades", label: "Specialybės", type: "multiSelect", settings: sel(TRADES) },
        { key: "workersNeeded", label: "Reikia žmonių", type: "number", settings: { decimals: 0, min: 1, max: 500 } },
        { key: "driversNeeded", label: "Iš jų vairuotojų", type: "number", settings: { decimals: 0, min: 0, max: 100 } },
        { key: "startDate", label: "Pradžia", type: "date" },
        { key: "durationWeeks", label: "Trukmė, sav.", type: "number", settings: { decimals: 0, min: 1, max: 104 } },
        { key: "country", label: "Šalis", type: "text", settings: { maxLength: 60 } },
        { key: "site", label: "Objektas / miestas", type: "text", settings: { maxLength: 120 } },
        { key: "requirements", label: "Reikalavimai (sertifikatai, kalba, patirtis)", type: "longText" },
        { key: "estimatedValue", label: "Numatoma vertė", type: "currency", settings: { defaultCurrency: "EUR" } },
        { key: "responseHours", label: "Atsakymo laikas, val.", type: "number", settings: { decimals: 0, min: 0 } },
        {
          key: "lostReason",
          label: "Praradimo priežastis",
          type: "select",
          settings: sel([
            ["competitor_faster", "Konkurentas atsakė greičiau", "red"],
            ["price", "Kaina", "orange"],
            ["no_people", "Neturėjome žmonių", "yellow"],
            ["documents", "Trūko dokumentų / sertifikatų", "purple"],
            ["other", "Kita", "gray"],
          ]),
        },
      ],
      views: [
        { name: "Užklausų eiga", kind: "kanban", groupBy: "stage", columns: ["name", "company", "workersNeeded", "startDate", "estimatedValue"] },
        {
          name: "Visos užklausos",
          kind: "table",
          columns: ["name", "stage", "company", "trades", "workersNeeded", "startDate", "country", "estimatedValue", "responseHours"],
          sort: { fieldKey: "receivedAt", direction: "desc" },
        },
      ],
    },
  ],
})
