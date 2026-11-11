"use client"
// The "Diagrama" tab of an automation: the diagram (statuses from the latest real run,
// or from a test run while one is shown), a side panel per node, and "Išbandyti
// diagramą". The React Flow canvas loads on the client only.
import type { AutomationView } from "@digimuza/system-core/automations"
import { useQuery } from "convex/react"
import { FlaskConical, Pencil } from "lucide-react"
import dynamic from "next/dynamic"
import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/lib/i18n/client"
import { convexApi as api, relativeTime, RunStatusBadge, useIsDesktop, useSiteUrl } from "../shared"
import { StatusDot, stepTitle, type FlowAutomation } from "./flow-diagram"
import { StepConfig, TestStepOutput } from "./flow-panels"
import { flowSteps, statusesFromRun, statusesFromTest, stepIds } from "./model"
import { TestRunPanel, useTestAnimation, type TestRunState } from "./test-run"

const FlowDiagram = dynamic(() => import("./flow-diagram").then((m) => m.FlowDiagram), {
  ssr: false,
  loading: () => <Skeleton className="h-[22rem] w-full rounded-xl" />,
})

/** The diagram's view of a saved automation (endpoint: its address or hook URL). */
export function useFlowAutomation(a: AutomationView, model: string | null): FlowAutomation {
  const site = useSiteUrl()
  return useMemo(
    () => ({
      name: a.name,
      trigger: a.trigger,
      extract: a.extract,
      actions: a.actions,
      mode: a.mode,
      endpoint: a.trigger.channel === "email" && a.trigger.emailSource !== "webhook" ? a.inboundAddress : `${site}${a.hook.path}`,
      model,
    }),
    [a, site, model],
  )
}

export function AutomationFlowTab({ automation: a, canManage, onEdit }: { automation: AutomationView; canManage: boolean; onEdit?: () => void }) {
  const { t, locale } = useT()
  const desktop = useIsDesktop()
  const latest = useQuery(api.automations.listRuns, { automationId: a.id, limit: 1 })
  const lastRun = latest?.items[0] ?? null
  const [test, setTest] = useState<TestRunState>({ result: null, running: false })
  const flow = useFlowAutomation(a, test.result?.model ?? lastRun?.model ?? null)
  const ids = useMemo(() => stepIds(flow), [flow])
  const animation = useTestAnimation(ids)
  const [testOpen, setTestOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const steps = useMemo(() => flowSteps(flow), [flow])
  const step = steps.find((s) => s.id === selected) ?? null

  const statuses = useMemo(() => {
    if (animation.statuses) return animation.statuses
    if (test.result) return statusesFromTest(flow, test.result)
    return lastRun ? statusesFromRun(flow, lastRun) : {}
  }, [animation.statuses, test.result, lastRun, flow])
  const durations = useMemo(() => {
    const r = test.result
    if (!r || test.running) return {}
    const d: Record<string, number> = { channel: r.trigger.durationMs, extract: r.extract.durationMs }
    r.actions.forEach((x, i) => {
      if (x.status !== "skipped") d[`action-${i}`] = x.durationMs
    })
    return d
  }, [test])

  const onSelect = useCallback((id: string) => setSelected(id), [])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("auto.flow.lastRun")}:</span>
          {lastRun ? (
            <>
              <RunStatusBadge status={lastRun.status} />
              <span>{relativeTime(lastRun.createdAt, locale)}</span>
            </>
          ) : (
            <span>{latest === undefined ? "…" : t("auto.flow.lastRunNone")}</span>
          )}
          {test.result && !test.running && <span className="rounded-full border border-primary/40 px-2 py-0.5 text-xs text-foreground">{t("auto.flow.test.output")}</span>}
        </p>
        {canManage && (
          <Button variant={testOpen ? "secondary" : "default"} onClick={() => setTestOpen((v) => !v)} aria-expanded={testOpen} aria-controls="flow-test">
            <FlaskConical />
            {t("auto.flow.test.button")}
          </Button>
        )}
      </div>

      <FlowDiagram automation={flow} statuses={statuses} durations={durations} selectedId={selected} onSelect={onSelect} direction={desktop ? "LR" : "TB"} />

      {testOpen && (
        <div id="flow-test">
          <TestRunPanel automationId={a.id} automation={flow} canManage={canManage} animation={animation} state={test} setState={setTest} onSelectStep={onSelect} />
        </div>
      )}

      <Sheet open={!!step} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          {step && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="flex items-center gap-2">
                  {stepTitle(t, step)}
                  {statuses[step.id] && <StatusDot status={statuses[step.id]!} />}
                </SheetTitle>
                <SheetDescription>{t("auto.flow.config")}</SheetDescription>
              </SheetHeader>
              <div className="grid gap-6 p-4">
                <StepConfig step={step} automation={flow} />
                {test.result && !test.running && (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-semibold">{t("auto.flow.test.output")}</h3>
                    <TestStepOutput step={step} automation={flow} result={test.result} />
                  </section>
                )}
                {canManage && onEdit && (
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => {
                      setSelected(null)
                      onEdit()
                    }}
                  >
                    <Pencil />
                    {t("auto.flow.editIn")}
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
