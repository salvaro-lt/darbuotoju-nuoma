"use client"
import { createContext, useContext, type ReactNode } from "react"
import { MESSAGES, type Locale, type MessageKey } from "./messages"

const LocaleContext = createContext<Locale>("lt")

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useT() {
  const locale = useContext(LocaleContext)
  const dict = MESSAGES[locale]
  return { locale, t: (key: MessageKey) => dict[key] }
}
