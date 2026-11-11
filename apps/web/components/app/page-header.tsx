import type { ReactNode } from "react"
import { FrameRuler, frameStartFor } from "./frame-ruler"

/**
 * Page title as a stencilled block marking over the frame ruler. The title is
 * the only stencil on the screen; the lead stays in the calm UI face.
 */
export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-3">
        <div className="min-w-0">
          <h1 className="font-stencil-title text-[2.1rem] text-foreground sm:text-[2.6rem]">{title}</h1>
          {lead && <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="border-t-2 border-foreground/80">
        <FrameRuler start={frameStartFor(title)} />
      </div>
    </header>
  )
}
