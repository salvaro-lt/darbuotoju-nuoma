// A blueprint is the CRM data model an app starts from: which objects exist,
// their fields and their first views. It is configuration, per client app:
//
//   defineCrm(system, { blueprint: standardBlueprint("lt") })            // companies, people, deals
//   defineCrm(system, { blueprint: extendBlueprint(standardBlueprint("lt"), { objects: [...] }) })
//   defineCrm(system, { blueprint: emptyBlueprint })                     // admins build everything in the UI
//
// Installing is additive and idempotent: missing objects and fields are
// created; anything that exists (by key) is left exactly as admins changed it.
// Objects and fields are only ever archived, never deleted, so a re-install
// never brings back what an admin removed.
import type { FieldSettings, FieldType, ViewFilter, ViewSort } from "./fields"

export interface BlueprintField {
  key: string
  label: string
  type: FieldType
  settings?: FieldSettings
  required?: boolean
  description?: string
}

export interface BlueprintView {
  name: string
  kind: "table" | "kanban"
  /** Field keys in column order. Defaults to every field. */
  columns?: string[]
  /** kanban: a `select` field */
  groupBy?: string
  sort?: ViewSort
  filters?: ViewFilter[]
}

export interface BlueprintObject {
  key: string
  nameSingular: string
  namePlural: string
  description?: string
  /** lucide icon name, e.g. "building-2" */
  icon: string
  /** A text field shown as the record's title. Must be one of `fields`. */
  labelFieldKey: string
  fields: BlueprintField[]
  /** Created only together with the object. The first one is the default. */
  views?: BlueprintView[]
}

export interface CrmBlueprint {
  objects: BlueprintObject[]
}

export const emptyBlueprint: CrmBlueprint = { objects: [] }

/**
 * Adds objects, and fields or views to existing objects. Objects and fields
 * with an existing key are replaced by the extension's version.
 */
export function extendBlueprint(base: CrmBlueprint, ext: { objects?: BlueprintObject[]; fields?: Record<string, BlueprintField[]>; views?: Record<string, BlueprintView[]> }): CrmBlueprint {
  const objects = new Map(base.objects.map((o) => [o.key, { ...o, fields: [...o.fields], views: [...(o.views ?? [])] }]))
  for (const o of ext.objects ?? []) objects.set(o.key, { ...o, fields: [...o.fields], views: [...(o.views ?? [])] })
  for (const [key, fields] of Object.entries(ext.fields ?? {})) {
    const o = objects.get(key)
    if (!o) throw new Error(`extendBlueprint: no object "${key}" for fields`)
    for (const f of fields) {
      const i = o.fields.findIndex((x) => x.key === f.key)
      if (i >= 0) o.fields[i] = f
      else o.fields.push(f)
    }
  }
  for (const [key, views] of Object.entries(ext.views ?? {})) {
    const o = objects.get(key)
    if (!o) throw new Error(`extendBlueprint: no object "${key}" for views`)
    o.views = [...(o.views ?? []), ...views]
  }
  return { objects: [...objects.values()] }
}

type Locale = "lt" | "en"

const L = <T>(locale: Locale, lt: T, en: T) => (locale === "lt" ? lt : en)

/** Companies, people and deals (with a pipeline), in the given language. */
export function standardBlueprint(locale: Locale = "lt"): CrmBlueprint {
  const t = <T>(lt: T, en: T) => L(locale, lt, en)
  return {
    objects: [
      {
        key: "company",
        nameSingular: t("Įmonė", "Company"),
        namePlural: t("Įmonės", "Companies"),
        description: t("Organizacijos, su kuriomis dirbate", "Organisations you work with"),
        icon: "building-2",
        labelFieldKey: "name",
        fields: [
          { key: "name", label: t("Pavadinimas", "Name"), type: "text", required: true },
          { key: "domain", label: t("Svetainė", "Website"), type: "url" },
          { key: "companyCode", label: t("Įmonės kodas", "Company code"), type: "text", settings: { maxLength: 32 } },
          { key: "vatCode", label: t("PVM kodas", "VAT number"), type: "text", settings: { maxLength: 32 } },
          {
            key: "industry",
            label: t("Sritis", "Industry"),
            type: "select",
            settings: {
              options: [
                { value: "it", label: t("IT", "IT"), color: "blue" },
                { value: "manufacturing", label: t("Gamyba", "Manufacturing"), color: "orange" },
                { value: "retail", label: t("Prekyba", "Retail"), color: "green" },
                { value: "services", label: t("Paslaugos", "Services"), color: "purple" },
                { value: "public", label: t("Viešasis sektorius", "Public sector"), color: "teal" },
                { value: "other", label: t("Kita", "Other"), color: "gray" },
              ],
            },
          },
          { key: "employees", label: t("Darbuotojai", "Employees"), type: "number", settings: { decimals: 0, min: 0 } },
          { key: "annualRevenue", label: t("Metinė apyvarta", "Annual revenue"), type: "currency", settings: { defaultCurrency: "EUR" } },
          { key: "address", label: t("Adresas", "Address"), type: "longText" },
          { key: "isCustomer", label: t("Klientas", "Customer"), type: "boolean" },
        ],
        views: [{ name: t("Visos įmonės", "All companies"), kind: "table", columns: ["name", "domain", "industry", "employees", "isCustomer"], sort: { fieldKey: "name", direction: "asc" } }],
      },
      {
        key: "person",
        nameSingular: t("Asmuo", "Person"),
        namePlural: t("Žmonės", "People"),
        description: t("Kontaktai įmonėse", "Contacts at companies"),
        icon: "user-round",
        labelFieldKey: "name",
        fields: [
          { key: "name", label: t("Vardas, pavardė", "Name"), type: "text", required: true },
          { key: "email", label: t("El. paštas", "Email"), type: "email" },
          { key: "phone", label: t("Telefonas", "Phone"), type: "phone" },
          { key: "jobTitle", label: t("Pareigos", "Job title"), type: "text" },
          { key: "company", label: t("Įmonė", "Company"), type: "relation", settings: { objectKey: "company", inverseLabel: t("Žmonės", "People") } },
          { key: "linkedin", label: "LinkedIn", type: "url" },
          { key: "city", label: t("Miestas", "City"), type: "text" },
        ],
        views: [{ name: t("Visi žmonės", "All people"), kind: "table", columns: ["name", "email", "phone", "jobTitle", "company"], sort: { fieldKey: "name", direction: "asc" } }],
      },
      {
        key: "opportunity",
        nameSingular: t("Sandoris", "Deal"),
        namePlural: t("Sandoriai", "Deals"),
        description: t("Pardavimų galimybės ir jų etapai", "Sales opportunities and their stages"),
        icon: "target",
        labelFieldKey: "name",
        fields: [
          { key: "name", label: t("Pavadinimas", "Name"), type: "text", required: true },
          { key: "amount", label: t("Suma", "Amount"), type: "currency", settings: { defaultCurrency: "EUR" } },
          {
            key: "stage",
            label: t("Etapas", "Stage"),
            type: "select",
            required: true,
            settings: {
              options: [
                { value: "new", label: t("Naujas", "New"), color: "gray" },
                { value: "qualified", label: t("Kvalifikuotas", "Qualified"), color: "blue" },
                { value: "proposal", label: t("Pasiūlymas", "Proposal"), color: "purple" },
                { value: "negotiation", label: t("Derybos", "Negotiation"), color: "orange" },
                { value: "won", label: t("Laimėtas", "Won"), color: "green" },
                { value: "lost", label: t("Pralaimėtas", "Lost"), color: "red" },
              ],
            },
          },
          { key: "closeDate", label: t("Numatoma pabaiga", "Close date"), type: "date" },
          { key: "probability", label: t("Tikimybė, %", "Probability, %"), type: "number", settings: { decimals: 0, min: 0, max: 100 } },
          { key: "company", label: t("Įmonė", "Company"), type: "relation", settings: { objectKey: "company", inverseLabel: t("Sandoriai", "Deals") } },
          { key: "contact", label: t("Kontaktas", "Contact"), type: "relation", settings: { objectKey: "person", inverseLabel: t("Sandoriai", "Deals") } },
        ],
        views: [
          { name: t("Etapai", "Pipeline"), kind: "kanban", groupBy: "stage", columns: ["name", "amount", "company", "closeDate"] },
          { name: t("Visi sandoriai", "All deals"), kind: "table", columns: ["name", "stage", "amount", "company", "closeDate", "probability"], sort: { fieldKey: "closeDate", direction: "asc" } },
        ],
      },
    ],
  }
}
