import type { ReactNode } from "react"
import { brand } from "@/brand"
import { LanguageSwitch } from "@/components/auth/ui"
import { FrameRuler, FrameRulerVertical } from "@/components/app/frame-ruler"
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
      {/* The hull plate: dark steel, stencilled name, frame ruler on its edge. */}
      <aside className="dark relative overflow-hidden border-b bg-sidebar px-6 py-5 text-sidebar-foreground lg:flex lg:flex-col lg:justify-end lg:border-b-0 lg:p-12">
        <FrameRulerVertical start={120} className="hidden w-7 lg:block" />
        <div className="relative flex items-center gap-3.5 lg:max-w-md lg:flex-col lg:items-start lg:gap-6">
          <BrandMark size="md" />
          <div>
            <p className="font-stencil-title text-2xl lg:text-[4.25rem]">{brand.name}</p>
            <p className="text-sm text-sidebar-foreground/70 lg:mt-3 lg:text-base">{brand.tagline[locale]}</p>
          </div>
        </div>
        <div className="relative mt-10 hidden border-t-2 border-sidebar-foreground/70 lg:block">
          <FrameRuler start={120} className="[--tick:var(--sidebar-ruler)] [&_span]:text-sidebar-foreground/50" />
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
