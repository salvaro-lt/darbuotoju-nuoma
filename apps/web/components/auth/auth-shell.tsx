import type { ReactNode } from "react"
import { brand } from "@/brand"
import { LanguageSwitch } from "@/components/auth/ui"
import { BrandMark } from "@/components/brand-mark"
import { getT } from "@/lib/i18n/server"

/**
 * Frame for the screens around the WorkOS hosted sign-in (/login, /invite).
 * The client's brand on one side, one task on the other; one column on phones.
 */
export async function AuthShell({ children }: { children: ReactNode }) {
  const { locale, t } = await getT()
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-[minmax(22rem,5fr)_7fr] lg:grid-rows-none">
      <aside className="border-b px-6 py-5 lg:flex lg:flex-col lg:justify-end lg:border-r lg:border-b-0 lg:bg-muted lg:p-10">
        <div className="flex items-center gap-3.5 lg:max-w-sm lg:flex-col lg:items-start lg:gap-5">
          <BrandMark size="md" />
          <div>
            <p className="font-semibold tracking-tight lg:text-3xl">{brand.name}</p>
            <p className="text-sm text-muted-foreground lg:mt-1.5 lg:text-base">{brand.tagline[locale]}</p>
          </div>
        </div>
      </aside>
      <main className="flex flex-col items-center px-6 pb-6 pt-12 lg:p-10">
        <div className="my-auto flex w-full max-w-sm flex-col gap-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">{children}</div>
        <footer className="pt-10">
          <LanguageSwitch locale={locale} label={t("lang.switch")} />
        </footer>
      </main>
    </div>
  )
}
