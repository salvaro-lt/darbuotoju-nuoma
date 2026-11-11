"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { isLocale } from "./messages"
import { LOCALE_COOKIE } from "./server"

export async function setLocale(formData: FormData) {
  const locale = formData.get("locale")
  if (!isLocale(locale)) return
  ;(await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 })
  revalidatePath("/", "layout")
}
