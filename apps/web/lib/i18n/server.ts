import "server-only"
import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, isLocale, MESSAGES, type Locale, type MessageKey } from "./messages"

export const LOCALE_COOKIE = "locale"

/** Chosen language (cookie), else the browser's preference, else Lithuanian. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value
  if (isLocale(chosen)) return chosen
  const accept = (await headers()).get("accept-language") ?? ""
  for (const part of accept.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().slice(0, 2)
    if (isLocale(tag)) return tag
  }
  return DEFAULT_LOCALE
}

export async function getT() {
  const locale = await getLocale()
  const dict = MESSAGES[locale]
  return { locale, t: (key: MessageKey) => dict[key] }
}
