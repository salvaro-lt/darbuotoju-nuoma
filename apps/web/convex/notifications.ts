// Notifications: in-app list (bell) and email, per user preferences.
// Types are declared by modules (finance, roles, …); core stores type + params and
// the app renders the text. Emails go through convex/mail.ts (Resend).
import { defineNotifications } from "@digimuza/system-core/notifications"
import { getConvexEnv } from "../env"
import { sendMail } from "./mail"
import { system } from "./system"

type Params = Record<string, unknown>
type Locale = "lt" | "en"

const money = (cents: unknown, currency: unknown, locale: Locale) =>
  typeof cents === "number"
    ? new Intl.NumberFormat(locale === "lt" ? "lt-LT" : "en-GB", { style: "currency", currency: typeof currency === "string" ? currency : "EUR" }).format(cents / 100)
    : ""

const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "")

/** Subject + first line per type and language. Unknown types get a generic text. */
function render(type: string, p: Params, locale: Locale): { subject: string; line: string } {
  const lt = locale === "lt"
  switch (type) {
    case "finance.invoice_awaiting_approval":
      return lt
        ? { subject: `Sąskaita ${str(p.number)} laukia tvirtinimo`, line: `${str(p.customer)}, ${money(p.amountCents, p.currency, locale)}. Sąskaita sukurta kaip juodraštis ir laukia jūsų patvirtinimo.` }
        : { subject: `Invoice ${str(p.number)} awaits approval`, line: `${str(p.customer)}, ${money(p.amountCents, p.currency, locale)}. The invoice was created as a draft and awaits your approval.` }
    case "roles.role_assigned":
      return lt
        ? { subject: "Jums priskirta nauja rolė", line: `Jums priskirtos rolės: ${str(p.roleNames)}.` }
        : { subject: "You have a new role", line: `Roles assigned to you: ${str(p.roleNames)}.` }
    default:
      return lt ? { subject: "Naujas pranešimas", line: "Sistemoje jūsų laukia naujas pranešimas." } : { subject: "New notification", line: "A new notification is waiting for you in the system." }
  }
}

export const {
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  setNotificationPreference,
  _deliverNotificationEmail,
  _claimNotificationEmail,
  _recordNotificationEmail,
} = defineNotifications(system, {
  renderEmail: (type, params, rawLocale, { href }) => {
    const locale: Locale = rawLocale === "en" ? "en" : "lt"
    const { subject, line } = render(type, (params ?? {}) as Params, locale)
    const site = getConvexEnv().SITE_URL
    const link = `${site}${href ?? "/app"}`
    const footer = locale === "lt" ? "Pranešimų nustatymus galite keisti paskyroje." : "You can change notification settings in your account."
    return { subject, text: `${line}\n\n${locale === "lt" ? "Atidaryti" : "Open"}: ${link}\n\n${footer}` }
  },
  deliverEmail: async ({ to, subject, text }) => {
    await sendMail({ to, subject, text })
  },
}).functions
