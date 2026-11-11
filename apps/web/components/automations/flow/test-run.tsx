"use client"
// "Išbandyti diagramą": a sample (typed, or a past event from Vykdymai) → `testAutomation`
// (a dry run, nothing is saved) and the step-by-step reveal on the diagram. "Vykdyti
// tikrai" creates a real run that waits in the review queue (`submitTestRun`).
import type { AutomationTestResult, AutomationTestSample, EventView } from "@digimuza/system-core/automations"
import { useAction as useConvexAction, useConvex, useMutation, useQuery } from "convex/react"
import { FlaskConical, Loader2, Play, Send } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { MessageCard } from "../runs"
import { convexApi as api, relativeTime } from "../shared"
import { stepTitle, StatusDot, useReducedMotion, type FlowAutomation } from "./flow-diagram"
import { TestStepOutput } from "./flow-panels"
import { exampleJson, flowSteps, parseFieldLines, revealFrames, statusesFromTest, type StepStatus } from "./model"

const FRAME_MS = 320

/** Step statuses while a test runs and is revealed; `prefers-reduced-motion` jumps to the end. */
export function useTestAnimation(ids: readonly string[]) {
  const reduced = useReducedMotion()
  const [statuses, setStatuses] = useState<Record<string, StepStatus> | null>(null)
  const timers = useRef<number[]>([])
  const current = useRef<Record<string, StepStatus>>({})
  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }
  useEffect(() => clear, [])
  const set = useCallback((s: Record<string, StepStatus> | null) => {
    current.current = s ?? {}
    setStatuses(s)
  }, [])

  /** While waiting for the server: the message is checked, then the model runs. */
  const start = useCallback(() => {
    clear()
    const pending = Object.fromEntries(ids.map((id) => [id, "pending" as StepStatus]))
    set({ ...pending, channel: "running" })
    if (!reduced) timers.current.push(window.setTimeout(() => set({ ...current.current, extract: "running" }), FRAME_MS))
    else set({ ...pending, channel: "running", extract: "running" })
  }, [ids, reduced, set])

  /** Plays the finished result step by step. Resolves when the last frame shows. */
  const reveal = useCallback(
    (final: Record<string, StepStatus>) =>
      new Promise<void>((resolve) => {
        clear()
        const frames = revealFrames(ids, final, current.current)
        if (reduced || !frames.length) {
          set(frames.at(-1) ?? final)
          resolve()
          return
        }
        frames.forEach((f, i) =>
          timers.current.push(
            window.setTimeout(() => {
              set(f)
              if (i === frames.length - 1) resolve()
            }, i * FRAME_MS),
          ),
        )
      }),
    [ids, reduced, set],
  )

  const reset = useCallback(() => {
    clear()
    set(null)
  }, [set])

  return { statuses, start, reveal, reset }
}

type SourceKind = "sample" | "event"
type WebhookKind = "json" | "fields"

export interface TestRunState {
  result: AutomationTestResult | null
  running: boolean
}

export function TestRunPanel({
  automationId,
  automation,
  canManage,
  animation,
  state,
  setState,
  onSelectStep,
}: {
  automationId: string
  automation: FlowAutomation
  canManage: boolean
  animation: ReturnType<typeof useTestAnimation>
  state: TestRunState
  setState: (s: TestRunState) => void
  onSelectStep: (id: string) => void
}) {
  const { t, locale } = useT()
  const convex = useConvex()
  const testAutomation = useConvexAction(api.automations.testAutomation)
  const submit = useMutation(api.automations.submitTestRun)
  const { run } = useAction()
  const real = useAction()
  const email = automation.trigger.channel === "email"
  const [source, setSource] = useState<SourceKind>("sample")
  const [webhookKind, setWebhookKind] = useState<WebhookKind>("json")
  const [from, setFrom] = useState("Jonas Jonaitis <jonas@example.com>")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [json, setJson] = useState(() => exampleJson(automation))
  const [fieldLines, setFieldLines] = useState("name: Jonas Jonaitis\nemail: jonas@example.com\nmessage: ")
  const [runId, setRunId] = useState<string>("")
  const [event, setEvent] = useState<EventView | null>(null)
  const [confirmReal, setConfirmReal] = useState(false)
  const recent = useQuery(api.automations.listRuns, source === "event" ? { automationId, limit: 15 } : "skip")

  const sample = (): AutomationTestSample => {
    if (email) return { from, subject, text: body }
    return webhookKind === "json" ? { json } : { fields: parseFieldLines(fieldLines) }
  }
  const args = () => (source === "event" && event ? { eventId: event.id } : { sample: sample() })
  const ready = source === "event" ? !!event : email ? !!(body.trim() || subject.trim()) : webhookKind === "json" ? !!json.trim() : Object.keys(parseFieldLines(fieldLines)).length > 0

  const pickRun = async (id: string) => {
    setRunId(id)
    setEvent(null)
    const res = await run(() => convex.query(api.automations.getRun, { runId: id }))
    if (res?.event) setEvent(res.event)
  }

  const go = async () => {
    setState({ result: null, running: true })
    animation.start()
    const res = await run(() => testAutomation({ automationId, ...args() }))
    if (!res) {
      animation.reset()
      setState({ result: null, running: false })
      return
    }
    await animation.reveal(statusesFromTest(automation, res))
    setState({ result: res, running: false })
  }

  const goReal = async () => {
    const res = await real.run(() => submit({ automationId, ...args() }))
    setConfirmReal(false)
    if (!res) return
    if (res.ignored) toast.info(t("auto.flow.test.realIgnored"))
    else
      toast.success(t("auto.flow.test.realDone"), {
        action: { label: t("auto.flow.test.openReview"), onClick: () => window.location.assign(`/app/automations/review?run=${res.runId}`) },
      })
  }

  if (!canManage) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t("auto.flow.test.noPermission")}</p>

  const steps = flowSteps(automation)
  return (
    <section aria-labelledby="flow-test-title" className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <header className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 id="flow-test-title" className="font-semibold">
            {t("auto.flow.test.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("auto.flow.test.lead")}</p>
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Tabs value={source} onValueChange={(v) => setSource(v as SourceKind)}>
            <TabsList aria-label={t("auto.flow.test.source")}>
              <TabsTrigger value="sample">{t("auto.flow.test.sourceSample")}</TabsTrigger>
              <TabsTrigger value="event">{t("auto.flow.test.sourceEvent")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {source === "event" ? (
            <>
              <Field>
                <FieldLabel htmlFor="ft-event">{t("auto.flow.test.pickEvent")}</FieldLabel>
                <Select value={runId} onValueChange={(v) => void pickRun(v)} disabled={!recent?.items.length}>
                  <SelectTrigger id="ft-event" className="w-full">
                    <SelectValue placeholder={recent && !recent.items.length ? t("auto.flow.test.noEvents") : t("auto.flow.test.pickEvent")} />
                  </SelectTrigger>
                  <SelectContent>
                    {recent?.items.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="truncate">{r.message?.subject || r.message?.from || t("auto.runs.noSubject")}</span>
                        <span className="text-xs text-muted-foreground">{relativeTime(r.createdAt, locale)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {event && <MessageCard event={event} className="max-h-72 overflow-hidden" />}
            </>
          ) : email ? (
            <>
              <Field>
                <FieldLabel htmlFor="ft-from">{t("auto.flow.test.from")}</FieldLabel>
                <Input id="ft-from" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ft-subject">{t("auto.flow.test.subject")}</FieldLabel>
                <Input id="ft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ft-body">{t("auto.flow.test.body")}</FieldLabel>
                <Textarea id="ft-body" rows={7} value={body} placeholder={t("auto.test.samplePlaceholder")} onChange={(e) => setBody(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Tabs value={webhookKind} onValueChange={(v) => setWebhookKind(v as WebhookKind)}>
                <TabsList>
                  <TabsTrigger value="json">{t("auto.flow.test.json")}</TabsTrigger>
                  <TabsTrigger value="fields">{t("auto.flow.test.fields")}</TabsTrigger>
                </TabsList>
              </Tabs>
              {webhookKind === "json" ? (
                <Field>
                  <FieldLabel htmlFor="ft-json">{t("auto.flow.test.json")}</FieldLabel>
                  <Textarea id="ft-json" rows={9} className="font-mono text-[13px]" value={json} spellCheck={false} onChange={(e) => setJson(e.target.value)} />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="ft-fields">{t("auto.flow.test.fields")}</FieldLabel>
                  <Textarea id="ft-fields" rows={7} className="font-mono text-[13px]" value={fieldLines} spellCheck={false} onChange={(e) => setFieldLines(e.target.value)} />
                  <FieldDescription>{t("auto.flow.test.fieldsHint")}</FieldDescription>
                </Field>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!ready || state.running} onClick={() => void go()}>
              {state.running ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Play />}
              {state.running ? t("auto.flow.test.running") : state.result ? t("auto.flow.test.again") : t("auto.flow.test.run")}
            </Button>
            <Button type="button" variant="outline" disabled={!ready || state.running || real.busy} onClick={() => setConfirmReal(true)}>
              <Send />
              {t("auto.flow.test.real")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("auto.flow.test.dry")}</p>
        </div>

        <div className="grid content-start gap-2" aria-live="polite" aria-busy={state.running}>
          <h3 className="text-sm font-semibold">{t("auto.flow.test.steps")}</h3>
          {!animation.statuses && !state.result ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("auto.flow.test.empty")}</p>
          ) : (
            <ol className="grid gap-2">
              {steps.map((s) => {
                const status = animation.statuses?.[s.id] ?? "pending"
                const showOutput = state.result && !state.running
                return (
                  <li key={s.id} className="rounded-lg border bg-background">
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelectStep(s.id)}>
                      <StatusDot status={status} />
                      <span className="flex-1 font-medium">{stepTitle(t, s)}</span>
                      <span className="text-xs text-muted-foreground">{t(`auto.flow.status.${status}` as MessageKey)}</span>
                    </button>
                    {showOutput && status !== "skipped" && (
                      <div className="border-t px-3 py-2">
                        <TestStepOutput step={s} automation={automation} result={state.result!} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      <Dialog open={confirmReal} onOpenChange={setConfirmReal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auto.flow.test.realTitle")}</DialogTitle>
            <DialogDescription>{t("auto.flow.test.realBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReal(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={real.busy} onClick={() => void goReal()}>
              {real.busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              {t("auto.flow.test.real")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

