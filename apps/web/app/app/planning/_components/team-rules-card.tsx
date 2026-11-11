"use client"
// Team composition rules on the teams proposal page (app/app/teams/[id]).
import { RULE_BREAKS, type RuleWarning, type TeamRules } from "@digimuza/staffing/planning/rules"
import { CheckCircle2, Home, Scale, Sparkles } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

export function TeamRulesCard(props: {
  rules: TeamRules & { stored: boolean }
  warnings: RuleWarning[]
  text: { lt: string[]; en: string[] }
  swaps: { out: string; in: string; reason: "drivers" | "english" | "language" }[]
  names: Record<string, string>
}) {
  const { t, locale } = useT()
  const text = locale === "en" ? props.text.en : props.text.lt
  const r = props.rules
  const breaks = props.warnings.map((w, i) => ({ w, s: text[i]! })).filter((x) => RULE_BREAKS.includes(x.w.code))
  const hints = props.warnings.map((w, i) => ({ w, s: text[i]! })).filter((x) => !RULE_BREAKS.includes(x.w.code))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="size-4" />
          {t("planning.teamRules.title")}
        </CardTitle>
        <CardDescription>
          {r.driversPerPeople ? `${t("planning.rules.driverEvery")} ${r.driversPerPeople} ${t("planning.rules.people")}` : t("planning.teamRules.noDrivers")} · {t(`planning.rules.english.${r.english}` as MessageKey)}
          {r.languageCompatibility && ` · ${t("planning.teamRules.common")}`} · {r.stored ? t("planning.teamRules.client") : t("planning.teamRules.defaults")}{" "}
          <Link href="/app/planning/settings" className="text-primary hover:underline">
            {t("planning.teamRules.edit")}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {breaks.length === 0 ? (
          <p className="flex items-center gap-2 text-steel-green">
            <CheckCircle2 className="size-4" />
            {t("planning.teamRules.ok")}
          </p>
        ) : (
          <ul className="grid gap-2">
            {breaks.map((x, k) => (
              <li key={k} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 bg-destructive/80" aria-hidden />
                {x.s}
              </li>
            ))}
          </ul>
        )}
        {hints.length > 0 && (
          <div className="grid gap-1.5 border-t pt-3">
            <div className="text-xs text-muted-foreground">{t("planning.teamRules.housing")}</div>
            <ul className="grid gap-1.5">
              {hints.map((x, k) => (
                <li key={k} className="flex items-center gap-2">
                  <Home className="size-3.5 shrink-0 text-muted-foreground" />
                  {x.s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {props.swaps.length > 0 && (
          <div className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
            {props.swaps.map((s, k) => (
              <p key={k} className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 shrink-0" />
                {props.names[s.in] ?? "?"} ← {props.names[s.out] ?? "?"} ({t(`planning.teamRules.swap.${s.reason}` as MessageKey)})
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
