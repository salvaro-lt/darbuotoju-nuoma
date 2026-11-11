/**
 * The client's brand. One per copy of the template: set this when creating a
 * client app (README → "Create a new client app"). Nothing here mentions
 * Digimuza; end users see only the client's name.
 *
 * Keep the WorkOS hosted sign-in page in step: WorkOS dashboard → Branding,
 * same logo, accent colour and font.
 */
export const brand = {
  /** Shown in the sign-in screens, the navigation and the page title. */
  name: "Darbuotojų nuoma",
  /** One-line description under the name on the sign-in screen. Per language. */
  tagline: {
    lt: "Darbuotojų, komandų ir projektų sistema",
    en: "Workers, teams and projects",
  },
  /** Path under /public, e.g. "/brand/logo.svg". null shows a monogram from `name`. */
  logo: null as string | null,
  /** Primary action colour. Each must keep 4.5:1 contrast with `accentText`. */
  accent: { light: "#9a3a1f", dark: "#e8845c" },
  accentText: { light: "#ffffff", dark: "#1c0d07" },
  /**
   * Radix Themes accent for the WorkOS account widgets, the closest named scale
   * to `accent` (see https://www.radix-ui.com/colors).
   */
  widgetAccent: "tomato" as const,
} as const

export type Brand = typeof brand
