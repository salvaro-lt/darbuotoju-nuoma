"use client"
// Gantt-like grid for one project: workers × days (coloured by site), then beds and vehicles per day.
import type { LogisticsPlan } from "@digimuza/staffing"
import type { ReactNode } from "react"
import { useT } from "@/lib/i18n/client"

const OTHER_COLORS = ["bg-secondary", "bg-steel-green/70", "bg-marking/70", "bg-secondary", "bg-steel-green/70"]

const dayOfWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()

export function Timeline({ plan }: { plan: LogisticsPlan }) {
  const { t, locale } = useT()
  const days = plan.plan.days.map((d) => d.date)
  const today = plan.window.today
  const cols = { gridTemplateColumns: `minmax(11rem, 14rem) repeat(${days.length}, minmax(1.5rem, 1fr))` }
  const otherColor = new Map<string, string>()
  for (const s of plan.segments) if (!s.own && !otherColor.has(s.projectId)) otherColor.set(s.projectId, OTHER_COLORS[otherColor.size % OTHER_COLORS.length]!)
  const noBed = new Map<string, { from: string; to: string }[]>()
  for (const w of plan.plan.warnings) if (w.kind === "no_bed" && w.workerId && w.from && w.to) noBed.set(w.workerId, [...(noBed.get(w.workerId) ?? []), { from: w.from, to: w.to }])
  const workers = [...new Map(plan.members.map((m) => [m.workerId, m.name])).entries()].filter(([id]) => plan.segments.some((s) => s.workerId === id) || plan.travelLegs.some((l) => l.workerId === id && l.date >= days[0]! && l.date <= days.at(-1)!))
  const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : "lt-LT", { weekday: "narrow", timeZone: "UTC" })

  const dayCell = (d: string, content: ReactNode, cls = "") => (
    <div key={d} className={`relative flex h-7 items-center justify-center border-l border-border/60 text-[10px] tabular-nums ${[0, 6].includes(dayOfWeek(d)) ? "bg-muted/40" : ""} ${d === today ? "ring-1 ring-primary/60 ring-inset" : ""} ${cls}`}>
      {content}
    </div>
  )
  const label = (text: ReactNode, sub?: ReactNode) => (
    <div className="sticky left-0 z-10 flex h-7 min-w-0 items-center gap-1.5 bg-card pr-2 text-xs">
      <span className="truncate">{text}</span>
      {sub && <span className="shrink-0 text-muted-foreground">{sub}</span>}
    </div>
  )
  const section = (title: string) => <div className="sticky left-0 col-span-full mt-2 bg-card pt-1 text-xs font-medium text-muted-foreground">{title}</div>

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border bg-card p-3">
        <div className="grid min-w-max" style={cols}>
          {/* header */}
          <div className="sticky left-0 z-10 bg-card" />
          {days.map((d) =>
            dayCell(
              d,
              <span className="flex flex-col items-center leading-none">
                <span className="text-muted-foreground">{weekday(d)}</span>
                <span className={d === today ? "font-semibold text-primary" : ""}>{Number(d.slice(8))}</span>
              </span>,
              dayOfWeek(d) === 1 ? "border-l-foreground/30" : "",
            ),
          )}
          {/* people vs beds */}
          {label(t("logistics.timeline.people"))}
          {plan.plan.days.map((d) =>
            dayCell(d.date, d.people || d.beds ? `${d.people}/${d.beds}` : "", d.people > d.beds ? "bg-destructive/80 font-semibold text-white" : d.people > 0 && d.people < d.beds ? "text-marking-foreground dark:text-marking dark:text-marking" : ""),
          )}
          {/* workers */}
          {workers.map(([id, name]) => (
            <Row key={id}>
              {label(name)}
              {days.map((d) => {
                const seg = plan.segments.find((s) => s.workerId === id && s.from <= d && s.to >= d)
                const leg = plan.travelLegs.find((l) => l.workerId === id && l.date === d)
                const bedless = noBed.get(id)?.some((r) => r.from <= d && r.to >= d)
                const color = seg ? (seg.own ? "bg-primary/70" : otherColor.get(seg.projectId)) : ""
                return dayCell(
                  d,
                  <>
                    {seg && <span className={`absolute inset-x-0 inset-y-1 ${color} ${bedless ? "ring-2 ring-destructive ring-inset" : ""}`} title={seg.projectCode} />}
                    {leg && <span className={`relative z-[1] size-2.5 rounded-full border-2 ${leg.booked ? "border-foreground bg-background" : "border-destructive/60 bg-destructive/15"}`} title={`${leg.fromCity} → ${leg.toCity}`} />}
                  </>,
                )
              })}
            </Row>
          ))}
          {/* beds */}
          {plan.accommodations.length > 0 && section(t("logistics.timeline.beds"))}
          {plan.accommodations.map((a) => {
            const load = plan.plan.accommodations.find((x) => x.id === a.id)?.load ?? []
            return (
              <Row key={a.id}>
                {label(a.name, `${a.beds}`)}
                {days.map((d, i) => {
                  const n = load[i]
                  if (n === null || n === undefined) return dayCell(d, "")
                  return dayCell(d, n, n > a.beds ? "bg-destructive/80 text-white font-semibold" : n < a.beds ? "bg-marking/60 dark:bg-marking/40" : "bg-steel-green/25 dark:bg-steel-green/30")
                })}
              </Row>
            )
          })}
          {/* vehicles */}
          {plan.vehicles.length > 0 && section(t("logistics.timeline.vehicles"))}
          {plan.vehicles.map((v) => {
            const row = plan.plan.vehicles.find((x) => x.id === v.id)
            return (
              <Row key={v.id}>
                {label(`${v.model} ${v.plate}`, `${v.seats}`)}
                {days.map((d, i) => {
                  const n = row?.load[i]
                  if (n === null || n === undefined) return dayCell(d, "")
                  const driverOk = row?.driverOk?.[i] ?? false
                  return dayCell(d, n, n > v.seats ? "bg-destructive/80 text-white font-semibold" : !driverOk ? "bg-destructive/15 text-destructive dark:bg-destructive/15 dark:text-destructive" : "bg-secondary dark:bg-secondary")
                })}
              </Row>
            )
          })}
        </div>
      </div>
      <Legend otherCodes={[...new Map(plan.segments.filter((s) => !s.own).map((s) => [s.projectId, s.projectCode])).entries()].map(([pid, code]) => [code, otherColor.get(pid)!] as const)} />
    </div>
  )
}

/** A grid row: its children are placed in the parent grid. */
function Row({ children }: { children: ReactNode }) {
  return <div className="contents">{children}</div>
}

function Legend({ otherCodes }: { otherCodes: (readonly [string, string])[] }) {
  const { t } = useT()
  const item = (swatch: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded-sm ${swatch}`} />
      {text}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item("bg-primary/70", t("logistics.timeline.legend.own"))}
      {otherCodes.map(([code, color]) => item(color, code))}
      {item("bg-primary/70 ring-2 ring-destructive ring-inset", t("logistics.team.noBed"))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border-2 border-foreground bg-background" />/<span className="size-2.5 rounded-full border-2 border-destructive/60 bg-destructive/15" />
        {t("logistics.timeline.legend.arrival")}
      </span>
      {item("bg-destructive/80", t("logistics.timeline.legend.short"))}
      {item("bg-marking/70", t("logistics.timeline.legend.empty"))}
      {item("bg-destructive/15 dark:bg-destructive/15", t("logistics.timeline.noDriver"))}
    </div>
  )
}
