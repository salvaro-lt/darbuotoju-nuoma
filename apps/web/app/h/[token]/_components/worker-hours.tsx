"use client"
import type { WorkerPortal } from "@digimuza/staffing"
import { addDays } from "@digimuza/staffing/pure"
import { isoWeek } from "@digimuza/staffing/timesheets/pure"
import { systemErrorOf } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Check, ChevronLeft, ChevronRight, Hand, HardHat, LinkIcon, Lock, Loader2, MapPin, PowerOff, Undo2 } from "lucide-react"
import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { brand } from "@/brand"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { MESSAGES, type Locale, type MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

type Ok = Extract<WorkerPortal, { state: "ok" }>
type Day = Ok["days"][number]
type Tr = (k: MessageKey, vars?: Record<string, string | number>) => string

const fill = (s: string, vars: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
const QUICK = [8, 10, 12]

/** The worker's own hours page: one week, a card per day, big touch targets. */
export function WorkerHoursPage({ token }: { token: string }) {
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined)
  const [locale, setLocale] = useState<Locale | null>(null)
  const data = useQuery(api.timesheets.workerPortal, { token, ...(weekStart ? { weekStart } : {}) })
  const lang: Locale = locale ?? (data && data.state === "ok" ? data.locale : "lt")
  const t: Tr = (k, vars) => fill(MESSAGES[lang][k], vars)
  const hours = (h: number | null | undefined) => (h === null || h === undefined ? "—" : lang === "lt" ? String(h).replace(".", ",") : String(h))

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const toggle = (
    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setLocale(lang === "lt" ? "en" : "lt")}>
      {t("wh.language")}
    </Button>
  )

  if (data === undefined)
    return (
      <Shell t={t} bar={toggle}>
        <div className="grid gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Shell>
    )
  if (data.state !== "ok")
    return (
      <Shell t={t} bar={toggle}>
        <div className="my-16 grid gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border [&>svg]:size-5">{data.state === "not_found" ? <LinkIcon /> : <PowerOff />}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{t(`wh.${data.state === "not_found" ? "notFound" : "unavailable"}.title`)}</h1>
          <p className="text-muted-foreground">{t(`wh.${data.state === "not_found" ? "notFound" : "unavailable"}.body`)}</p>
        </div>
      </Shell>
    )

  const thisWeek = addDays(data.today, -((new Date(`${data.today}T00:00:00Z`).getUTCDay() + 6) % 7))
  return (
    <Shell t={t} bar={toggle}>
      <section className="grid gap-1">
        <p className="text-sm text-muted-foreground">{t("wh.hello", { name: data.worker.firstName })}</p>
        <h1 className="font-stencil-title text-[2rem] leading-none">{t("wh.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("wh.lead")}</p>
      </section>

      {data.current ? (
        <section className="flex items-start gap-3 rounded-lg border bg-card p-3">
          <HardHat className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 text-sm">
            <div className="font-medium">{data.current.projectName}</div>
            <div className="text-muted-foreground">
              <span className="font-mono text-xs">{data.current.projectCode}</span> · {data.current.clientName}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="size-3.5" />
              {data.current.city} · {data.current.trade}
            </div>
          </div>
        </section>
      ) : (
        <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">{t("wh.noProject")}</p>
      )}

      <nav className="flex items-center justify-between gap-2" aria-label={t("wh.week", { n: isoWeek(data.weekStart) })}>
        <Button variant="outline" size="icon" className="size-11" aria-label={t("wh.prev")} onClick={() => setWeekStart(addDays(data.weekStart, -7))}>
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <div className="font-medium">{t("wh.week", { n: isoWeek(data.weekStart) })}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {short(data.weekStart, lang)} – {short(addDays(data.weekStart, 6), lang)}
          </div>
        </div>
        <Button variant="outline" size="icon" className="size-11" aria-label={t("wh.next")} disabled={data.weekStart >= thisWeek} onClick={() => setWeekStart(addDays(data.weekStart, 7))}>
          <ChevronRight />
        </Button>
      </nav>
      {data.weekStart !== thisWeek && (
        <Button variant="ghost" size="sm" className="-mt-2 justify-self-center" onClick={() => setWeekStart(undefined)}>
          {t("wh.thisWeek")}
        </Button>
      )}

      <ol className="grid gap-2.5">
        {data.days.map((d) => (
          <DayCard key={`${data.weekStart}-${d.date}`} token={token} day={d} today={data.today} t={t} lang={lang} hours={hours} />
        ))}
      </ol>

      <p className="rounded-lg bg-secondary px-3 py-2 text-center text-sm tabular-nums">{t("wh.total", { mine: hours(data.totals.mine), client: data.days.some((d) => d.clientCovered) ? hours(data.totals.client) : "—" })}</p>
    </Shell>
  )
}

function short(iso: string, lang: Locale) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "lt" ? "lt-LT" : "en-GB", { timeZone: "UTC", month: "2-digit", day: "2-digit" })
}

function Shell({ t, bar, children }: { t: Tr; bar?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex min-h-14 w-full max-w-md items-center gap-3 px-4 py-2">
          <BrandMark size="sm" />
          <span className="truncate text-sm font-semibold tracking-tight">{brand.name}</span>
          {bar}
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 content-start gap-4 px-4 py-5">{children}</main>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">{t("wh.footer")}</footer>
    </div>
  )
}

function DayCard({ token, day, today, t, lang, hours }: { token: string; day: Day; today: string; t: Tr; lang: Locale; hours: (h: number | null | undefined) => string }) {
  const save = useMutation(api.timesheets.saveMyHours)
  const flag = useMutation(api.timesheets.flagMyDay)
  const unflag = useMutation(api.timesheets.clearMyFlag)
  const isToday = day.date === today
  const [open, setOpen] = useState(isToday && day.editable && !day.mine)
  const [regular, setRegular] = useState(day.mine ? String(day.mine.regular) : "")
  const [overtime, setOvertime] = useState(day.mine?.overtime ? String(day.mine.overtime) : "")
  const [note, setNote] = useState(day.mine?.note ?? "")
  const [disagreeing, setDisagreeing] = useState(false)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const mine = day.mine ? day.mine.regular + day.mine.overtime : null
  const weekdayName = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(lang === "lt" ? "lt-LT" : "en-GB", { timeZone: "UTC", weekday: "long" })

  async function call(fn: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await fn()
      if (done) toast.success(done)
      return true
    } catch (e) {
      const se = systemErrorOf(e)
      toast.error(MESSAGES[lang][(se ? `error.${se.code}` : "error.unknown") as MessageKey] ?? MESSAGES[lang]["error.unknown"])
      return false
    } finally {
      setBusy(false)
    }
  }
  const num = (s: string) => {
    const n = Number(s.trim().replace(",", ".") || "0")
    return Number.isFinite(n) ? Math.round(n * 4) / 4 : Number.NaN
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (await call(() => save({ token, date: day.date, regularHours: num(regular), overtimeHours: num(overtime), ...(note.trim() ? { note } : {}) }), t("wh.saved"))) setOpen(false)
  }
  async function sendFlag(e: FormEvent) {
    e.preventDefault()
    if (await call(() => flag({ token, date: day.date, comment }))) {
      setDisagreeing(false)
      setComment("")
    }
  }

  const status =
    day.client === null ? (
      day.project && day.date <= today ? <span className="text-xs text-muted-foreground">{t("wh.clientPending")}</span> : null
    ) : day.diff === 0 && (mine ?? day.ours) !== null ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-steel-green">
        <Check className="size-3.5" />
        {t("wh.match")}
      </span>
    ) : day.diff !== 0 ? (
      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">{t("wh.mismatch", { diff: `${day.diff > 0 ? "+" : ""}${hours(day.diff)}` })}</span>
    ) : null

  return (
    <li className={cn("rounded-lg border bg-card", isToday && "border-primary/60 ring-1 ring-primary/30", !day.project && "opacity-60")}>
      <button type="button" className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-default" disabled={!day.editable} onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="w-24 shrink-0">
          <div className="text-sm font-medium capitalize">{weekdayName}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {short(day.date, lang)}
            {isToday && <span className="ml-1 font-medium text-primary">· {t("wh.today")}</span>}
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-3 gap-1 text-center">
          <Source label={t("wh.mine")} value={mine === null ? "—" : hours(mine)} strong />
          <Source label={t("wh.ours")} value={hours(day.ours)} />
          <Source label={t("wh.client")} value={day.client === null ? "—" : hours(day.client)} warn={day.client !== null && day.diff !== 0} />
        </dl>
        {!day.editable && day.project && <Lock className="size-4 shrink-0 text-muted-foreground" aria-label={t("wh.locked")} />}
      </button>
      {(status || day.mine?.disagree || !day.project) && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {!day.project ? <span className="text-xs text-muted-foreground">{t("wh.notOnProject")}</span> : status}
          {day.mine?.disagree && (
            <span className="inline-flex items-center gap-1 rounded bg-marking/25 px-1.5 py-0.5 text-xs font-medium text-marking-foreground">
              <Hand className="size-3.5" />
              {t("wh.disagreed")}
            </span>
          )}
        </div>
      )}
      {open && day.editable && (
        <div className="grid gap-3 border-t px-3 py-3">
          <form onSubmit={submit} className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t("wh.regular")}</span>
                <Input inputMode="decimal" className="h-12 text-lg tabular-nums" value={regular} onChange={(e) => setRegular(e.target.value)} placeholder="0" autoFocus={isToday} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t("wh.overtime")}</span>
                <Input inputMode="decimal" className="h-12 text-lg tabular-nums" value={overtime} onChange={(e) => setOvertime(e.target.value)} placeholder="0" />
              </label>
            </div>
            <div className="flex gap-2">
              {QUICK.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  className="h-10 flex-1"
                  onClick={() => {
                    setRegular(String(Math.min(q, 8)))
                    setOvertime(q > 8 ? String(q - 8) : "")
                  }}
                >
                  {q} {lang === "lt" ? "val." : "h"}
                </Button>
              ))}
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t("wh.note")}</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("wh.notePlaceholder")} maxLength={300} />
            </label>
            <Button type="submit" className="h-12 text-base" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t("wh.save")}
            </Button>
          </form>
          {day.mine?.disagree ? (
            <div className="grid gap-2 rounded-md bg-marking/15 p-3 text-sm">
              <span className="font-medium">{t("wh.disagreed")}</span>
              <span className="text-muted-foreground">„{day.mine.disagree}“</span>
              <Button type="button" variant="ghost" size="sm" className="justify-self-start" disabled={busy} onClick={() => call(() => unflag({ token, date: day.date }))}>
                <Undo2 />
                {t("wh.disagreeUndo")}
              </Button>
            </div>
          ) : disagreeing ? (
            <form onSubmit={sendFlag} className="grid gap-2 rounded-md border border-dashed p-3">
              <span className="text-sm font-medium">{t("wh.disagreeTitle")}</span>
              <span className="text-xs text-muted-foreground">{t("wh.disagreeLead")}</span>
              <Textarea rows={3} required value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("wh.disagreePlaceholder")} maxLength={500} />
              <Button type="submit" variant="destructive" className="h-11" disabled={busy || !comment.trim()}>
                <Hand />
                {t("wh.disagreeSend")}
              </Button>
            </form>
          ) : (
            <Button type="button" variant="outline" className="h-11" onClick={() => setDisagreeing(true)}>
              <Hand />
              {t("wh.disagree")}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function Source({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="grid">
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base tabular-nums", strong && "font-semibold", warn && "font-semibold text-destructive")}>{value}</dd>
    </div>
  )
}
