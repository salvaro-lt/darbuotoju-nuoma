"use client"
// "Ar turime 20 suvirintojų nuo pirmadienio?": the quick capacity answer with a copyable reply.
import { useQuery } from "convex/react"
import { CheckCircle2, Copy, MessageSquareReply, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { NativeSelect, workerHref } from "../../staffing/_components/staffing-ui"

type Trade = { id: string; code: string; nameLt: string; nameEn: string }
const WELDERS = "@welders"

export function CapacityCard({ trades, defaultFrom }: { trades: Trade[]; defaultFrom: string }) {
  const { t, locale } = useT()
  const [count, setCount] = useState("20")
  const [trade, setTrade] = useState(WELDERS)
  const [from, setFrom] = useState(defaultFrom)
  const [lang, setLang] = useState<"lt" | "en">(locale === "en" ? "en" : "lt")
  const tradeIds = useMemo(() => (trade === WELDERS ? trades.filter((x) => x.code.startsWith("WELD")).map((x) => x.id) : [trade]), [trade, trades])
  const n = Number(count)
  const valid = Number.isInteger(n) && n >= 1 && n <= 500 && /^\d{4}-\d{2}-\d{2}$/.test(from) && tradeIds.length > 0
  const a = useQuery(api.planning.capacity, valid ? { tradeIds: tradeIds as Id<"staffing_trades">[], count: n, from } : "skip")
  const name = (x: Trade) => (locale === "en" ? x.nameEn : x.nameLt)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareReply className="size-4" />
          {t("planning.capacity.title")}
        </CardTitle>
        <CardDescription>{t("planning.capacity.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => e.preventDefault()}>
          <span className="pb-2">{t("planning.capacity.q1")}</span>
          <Input aria-label={t("planning.capacity.count")} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} className="w-20 tabular-nums" />
          <NativeSelect aria-label={t("planning.capacity.trade")} value={trade} onChange={setTrade} className="min-w-52">
            <option value={WELDERS}>{t("planning.capacity.welders")}</option>
            {trades.map((x) => (
              <option key={x.id} value={x.id}>
                {name(x)}
              </option>
            ))}
          </NativeSelect>
          <span className="pb-2">{t("planning.capacity.q2")}</span>
          <Input aria-label={t("planning.capacity.from")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 tabular-nums" />
          <span className="pb-2">?</span>
        </form>

        {!valid ? null : a === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className={`text-4xl font-semibold tabular-nums ${a.shortfall ? "text-destructive" : "text-steel-green"}`}>
                  {Math.min(a.total, n)} / {n}
                </span>
                {a.shortfall ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <TriangleAlert className="size-4" />
                    {t("planning.capacity.short")} {a.shortfall}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-steel-green">
                    <CheckCircle2 className="size-4" />
                    {t("planning.capacity.enough")} ({t("planning.capacity.total")} {a.total})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Source label={t("planning.capacity.ownFree")} people={a.ownFree} />
                <Source label={t("planning.capacity.freed")} people={a.freedByEnding} />
                <Source label={t("planning.capacity.back")} people={a.backFromRest} />
                <Source label={t("planning.capacity.sub")} count={a.subcontractorTotal} lines={a.subcontractors.map((s) => `${s.name}: ${s.count}${s.declared > s.registered ? ` (${t("planning.capacity.declared")})` : ""}`)} />
              </div>
              {a.freedLater.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("planning.capacity.later")}:{" "}
                  {a.freedLater.map((p, i) => (
                    <span key={p.workerId}>
                      {i > 0 && ", "}
                      <Link href={workerHref(p.workerId)} className="hover:underline">
                        {p.name}
                      </Link>{" "}
                      <span className="tabular-nums">({p.date?.slice(5)})</span>
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div className="grid content-start gap-2">
              <div className="flex items-center justify-between gap-2">
                <Tabs value={lang} onValueChange={(v) => setLang(v as "lt" | "en")}>
                  <TabsList>
                    <TabsTrigger value="lt">LT</TabsTrigger>
                    <TabsTrigger value="en">EN</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(a.reply[lang].client).then(
                      () => toast.success(t("planning.capacity.copied")),
                      () => undefined,
                    )
                  }
                >
                  <Copy />
                  {t("planning.capacity.copy")}
                </Button>
              </div>
              <Textarea readOnly value={a.reply[lang].client} rows={3} className="text-sm" aria-label={t("planning.capacity.reply")} />
              <p className="text-xs text-muted-foreground">{a.reply[lang].internal}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Source({ label, people, count, lines }: { label: string; people?: { workerId: string; name: string; date: string | null; label: string | null }[]; count?: number; lines?: string[] }) {
  const n = people ? people.length : (count ?? 0)
  return (
    <details className="group rounded-[2px] border bg-card px-3 py-2 text-sm open:col-span-2 sm:open:col-span-4">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{n}</span>
      </summary>
      <ul className="mt-2 grid gap-0.5 text-xs sm:grid-cols-2">
        {people?.map((p) => (
          <li key={p.workerId}>
            <Link href={workerHref(p.workerId)} className="hover:underline">
              {p.name}
            </Link>
            {(p.label || p.date) && <span className="text-muted-foreground"> · {[p.label, p.date?.slice(5)].filter(Boolean).join(" · ")}</span>}
          </li>
        ))}
        {lines?.map((l) => <li key={l}>{l}</li>)}
        {n === 0 && <li className="text-muted-foreground">–</li>}
      </ul>
    </details>
  )
}
