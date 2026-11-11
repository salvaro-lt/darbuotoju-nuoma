"use client"
// What the side panel shows for a diagram node: its configuration, and the output of
// the step in the last test run (extracted JSON, validation errors, the would-be call).
import type { AutomationTestResult } from "@digimuza/system-core/automations"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { InputPreview } from "../runs"
import { CopyField, Problems, showValue, targetLabel } from "../shared"
import type { FlowAutomation } from "./flow-diagram"
import type { FlowStep } from "./model"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** A node's configuration (read-only). */
export function StepConfig({ step, automation }: { step: FlowStep; automation: FlowAutomation }) {
  const { t } = useT()
  if (step.kind === "channel") {
    const filters = Object.entries(automation.trigger.filters ?? {}).filter(([, v]) => v)
    return (
      <dl className="grid gap-3">
        <Row label={t("auto.flow.channel")}>{automation.trigger.channel === "email" ? t("auto.channel.email") : t("auto.channel.webhook")}</Row>
        {automation.trigger.channel === "email" && (
          <Row label={t("auto.flow.source")}>{t(automation.trigger.emailSource === "webhook" ? "auto.channel.source.webhook" : "auto.channel.source.resend")}</Row>
        )}
        {automation.endpoint && (
          <Row label={automation.trigger.channel === "email" && automation.trigger.emailSource !== "webhook" ? t("auto.flow.address") : t("auto.flow.url")}>
            <CopyField value={automation.endpoint} />
          </Row>
        )}
        <Row label={t("auto.flow.filters")}>
          {filters.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {filters.map(([k, v]) => (
                <li key={k}>
                  <Badge variant="outline">
                    {t(`auto.filters.short.${k}` as MessageKey)}: {String(v)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">{t("auto.flow.noFilters")}</span>
          )}
        </Row>
      </dl>
    )
  }
  if (step.kind === "extract") {
    return (
      <dl className="grid gap-3">
        <Row label={t("auto.flow.model")}>
          <span className="font-mono text-[13px]">{automation.model ?? t("auto.flow.modelDefault")}</span>
        </Row>
        <Row label={t("auto.flow.instructions")}>
          <p className="whitespace-pre-wrap text-muted-foreground">{automation.extract.instructions}</p>
        </Row>
        <Row label={t("auto.extract.fields")}>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {automation.extract.fields.map((f) => (
              <li key={f.name} className="grid gap-0.5 px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px]">{f.name}</span>
                  <Badge variant="secondary">{t(`auto.type.${f.type}` as MessageKey)}</Badge>
                  <span className="text-xs text-muted-foreground">{f.required ? t("auto.flow.required") : t("auto.flow.optional")}</span>
                </span>
                {f.description && <span className="text-xs text-muted-foreground">{f.description}</span>}
                {f.options?.length ? <span className="text-xs text-muted-foreground">{f.options.join(" · ")}</span> : null}
              </li>
            ))}
          </ul>
        </Row>
      </dl>
    )
  }
  if (step.kind === "action") {
    const action = automation.actions[step.index ?? 0]
    if (!action) return null
    return (
      <dl className="grid gap-3">
        <Row label={t("auto.insert.target")}>
          <span className="font-medium">{targetLabel(t, action.targetId)}</span>
          <span className="block font-mono text-xs text-muted-foreground">{action.targetId}</span>
        </Row>
        <Row label={t("auto.flow.mapped")}>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {Object.entries(action.mapping).map(([k, v]) => (
              <li key={k} className="grid gap-0.5 px-3 py-2">
                <span className="font-mono text-[13px]">{k}</span>
                <span className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{typeof v === "string" ? v : JSON.stringify(v)}</span>
              </li>
            ))}
          </ul>
        </Row>
      </dl>
    )
  }
  return (
    <dl className="grid gap-3">
      <Row label={t("auto.mode.title")}>{t(automation.mode === "auto" ? "auto.mode.auto" : "auto.mode.review")}</Row>
      <p className="text-sm text-muted-foreground">{t(automation.mode === "auto" ? "auto.flow.resultAuto" : "auto.flow.resultReview")}</p>
    </dl>
  )
}

const reasonText = (t: (k: MessageKey) => string, reason: string | null) => (reason ? t(`auto.flow.test.reason.${reason}` as MessageKey) || reason : "")

/** The output of one step in a test run. */
export function TestStepOutput({ step, automation, result }: { step: FlowStep; automation: FlowAutomation; result: AutomationTestResult }) {
  const { t } = useT()
  if (step.kind === "channel") {
    const m = result.message
    return (
      <div className="grid gap-2 text-sm">
        <p className={result.trigger.status === "ok" ? "" : "text-destructive"}>
          {result.trigger.status === "ok" ? t("auto.flow.test.filterOk") : t("auto.flow.test.filterFail").replace("{reason}", reasonText(t, result.trigger.reason))}
        </p>
        <dl className="grid gap-1 text-[13px] text-muted-foreground">
          {(m.from || m.fromName) && (
            <div>
              {m.fromName ? `${m.fromName} ` : ""}
              {m.from ? `<${m.from}>` : ""}
            </div>
          )}
          {m.subject && <div className="font-medium text-foreground">{m.subject}</div>}
        </dl>
      </div>
    )
  }
  if (step.kind === "extract") {
    const ex = result.extract
    if (ex.status === "skipped") return <p className="text-sm text-muted-foreground">{t("auto.flow.status.skipped")}</p>
    return (
      <div className="grid gap-2">
        {ex.error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {ex.error.message}
          </p>
        )}
        {ex.values && (
          <dl className="divide-y overflow-hidden rounded-lg border">
            {automation.extract.fields.map((f) => (
              <div key={f.name} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 px-3 py-1.5 text-sm">
                <dt className="truncate font-mono text-[13px] text-muted-foreground">{f.name}</dt>
                <dd className="break-words">{showValue(ex.values?.[f.name])}</dd>
              </div>
            ))}
          </dl>
        )}
        <Problems errors={ex.errors} />
        <p className="text-xs text-muted-foreground">
          {result.model} · {t("auto.flow.test.ms").replace("{ms}", String(ex.durationMs))}
          {ex.usage ? ` · ${t("auto.flow.test.tokens").replace("{n}", String(ex.usage.inputTokens + ex.usage.outputTokens))}` : ""} · {ex.attempts} {t("auto.run.attempts")}
        </p>
      </div>
    )
  }
  if (step.kind === "action") {
    const a = result.actions[step.index ?? 0]
    if (!a || a.status === "skipped") return <p className="text-sm text-muted-foreground">{t("auto.flow.status.skipped")}</p>
    return (
      <div className="grid gap-2 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("auto.flow.test.wouldCall")}: <span className="font-mono">{a.targetId}</span>
        </p>
        <div className="rounded-lg border p-3">
          <InputPreview input={a.input} />
        </div>
        {a.issues.length > 0 && <Problems errors={a.issues} />}
        {a.simulated.kind === "preview" ? (
          <div className="grid gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <p className="text-[13px] font-medium">{t("auto.flow.test.preview")}</p>
            <code className="font-mono text-xs break-all text-muted-foreground">{JSON.stringify(a.simulated.result)}</code>
          </div>
        ) : a.simulated.kind === "placeholder" && !a.issues.length ? (
          <p className="text-xs text-muted-foreground">{t("auto.flow.test.placeholder")}</p>
        ) : null}
      </div>
    )
  }
  const o = result.outcome
  return (
    <p className="text-sm">
      <span className="font-medium">{t(`auto.flow.test.wouldBe.${o.wouldBe}` as MessageKey)}</span>
      {o.reason && <span className="text-muted-foreground"> · {reasonText(t, o.reason)}</span>}
    </p>
  )
}
