"use client"
// The automation builder: Kanalas → AI ištraukimas → Įrašymas → Teisės ir režimas.
// Used for new automations and for editing (a new version). Validation is live
// (validateAutomation); the server re-validates on save.
import {
  AUTOMATION_FIELD_TYPES,
  AUTOMATIONS_AUTO_MODE_FLAG,
  MESSAGE_KEYS,
  type AutomationDefinition,
  type AutomationField,
  type AutomationMode,
  type AutomationView,
  type ExtractionResult,
  type TargetView,
} from "@digimuza/system-core/automations"
import { useFeatureFlag } from "@digimuza/system-core/react"
import { useAction as useConvexAction, useMutation, useQuery } from "convex/react"
import { ArrowLeft, ArrowRight, Braces, FlaskConical, Loader2, Mail, Plus, Sparkles, Trash2, Webhook } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState, type ReactNode } from "react"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { InboxPicker } from "@/components/ingest/inbox-picker"
import { convexApi as api, Problems, problemsFor, showValue, targetLabel } from "./shared"

type Draft = AutomationDefinition & { mode: AutomationMode; roleIds: string[] }

const STEPS = ["channel", "extract", "insert", "access"] as const
type Step = (typeof STEPS)[number]
const STEP_PREFIX: Record<Step, string[]> = { channel: ["name", "description", "trigger"], extract: ["extract"], insert: ["actions"], access: [] }

export const emptyDraft = (): Draft => ({
  name: "",
  trigger: { channel: "email", emailSource: "resend" },
  extract: { instructions: "", fields: [{ name: "name", type: "string", required: true }] },
  actions: [],
  mode: "review",
  roleIds: [],
})

export const draftOf = (a: AutomationView): Draft => ({
  name: a.name,
  ...(a.description ? { description: a.description } : {}),
  trigger: a.trigger,
  extract: a.extract,
  actions: a.actions,
  mode: a.mode,
  roleIds: a.roleIds,
})

const definitionOf = (d: Draft): AutomationDefinition => {
  const def: AutomationDefinition = { name: d.name, trigger: d.trigger, extract: d.extract, actions: d.actions }
  if (d.description?.trim()) def.description = d.description
  return def
}

/** Best guess for a target key from the fields and the message. */
function suggest(key: string, fields: readonly AutomationField[], second: boolean): string | undefined {
  const k = key.toLowerCase()
  const hit = fields.find((f) => f.name.toLowerCase() === k)
  if (hit) return `{{${hit.name}}}`
  if (second && /id$/i.test(key)) return `{{previous.${key}}}`
  if (["body", "text", "message", "notes"].includes(k)) return "{{message.text}}"
  if (k === "subject" || k === "title") return "{{message.subject}}"
  if (k === "from" || k === "name") return "{{message.fromName}}"
  if (k === "fromemail" || k === "email") return "{{message.from}}"
  return undefined
}

export function AutomationBuilder({ initial, automationId, ownerIsMe = true }: { initial: Draft; automationId?: string; ownerIsMe?: boolean }) {
  const { t } = useT()
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(initial)
  const [step, setStep] = useState<Step>("channel")
  const [autoRoles, setAutoRoles] = useState(initial.roleIds.length === 0)
  const targets = useQuery(api.automations.listAutomationTargets, {})
  const roles = useQuery(api.automations.listAutomationRoles, {})
  const report = useQuery(api.automations.validateAutomation, { definition: definitionOf(draft) })
  const autoModeOn = useFeatureFlag(AUTOMATIONS_AUTO_MODE_FLAG)
  const create = useMutation(api.automations.createAutomation)
  const update = useMutation(api.automations.updateAutomation)
  const rotate = useConvexAction(api.automations.rotateHookSecret)
  const { run, busy } = useAction()

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const errorsOf = (s: Step) => (report?.errors ?? []).filter((e) => STEP_PREFIX[s].some((p) => e.startsWith(p)))
  const warningsOf = (s: Step) => (report?.warnings ?? []).filter((e) => STEP_PREFIX[s].some((p) => e.startsWith(p)))
  const index = STEPS.indexOf(step)

  async function save() {
    const definition = definitionOf(draft)
    const roleIds = autoRoles ? undefined : draft.roleIds
    if (automationId) {
      const res = await run(() => update({ automationId, definition, mode: draft.mode, ...(roleIds ? { roleIds } : {}) }), { success: t("auto.saved") })
      if (res) router.push(`/app/automations/${automationId}`)
      return
    }
    const res = await run(() => create({ definition, mode: draft.mode, ...(roleIds ? { roleIds } : {}) }), { success: t("auto.created") })
    if (!res) return
    // Webhook channels need a token at once; it is shown once on the next page.
    const needsToken = draft.trigger.channel === "webhook" || draft.trigger.emailSource === "webhook"
    if (needsToken) {
      const secret = await run(() => rotate({ automationId: res.automationId }))
      if (secret) sessionStorage.setItem(`automation-secret:${res.automationId}`, secret.secret)
    }
    router.push(`/app/automations/${res.automationId}`)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label={t("auto.builder.steps")} className="lg:sticky lg:top-4 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1">
          {STEPS.map((s, i) => {
            const bad = errorsOf(s).length > 0
            return (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  aria-current={s === step ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                    s === step && "bg-muted font-medium",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                      s === step ? "border-primary bg-primary text-primary-foreground" : i < index ? "border-primary/40 text-primary" : "text-muted-foreground",
                      bad && s !== step && "border-destructive/50 text-destructive",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap">{t(`auto.step.${s}` as MessageKey)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="grid min-w-0 gap-6">
        {!ownerIsMe && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t("auto.builder.ownerChange")}</p>}

        {step === "channel" && <ChannelStep draft={draft} set={set} />}
        {step === "extract" && <ExtractStep draft={draft} set={set} />}
        {step === "insert" && <InsertStep draft={draft} set={set} targets={targets} />}
        {step === "access" && (
          <AccessStep draft={draft} set={set} roles={roles} autoRoles={autoRoles} setAutoRoles={setAutoRoles} autoModeOn={autoModeOn} targets={targets} errors={report?.errors ?? []} warnings={report?.warnings ?? []} />
        )}

        {step !== "access" && <Problems errors={errorsOf(step)} warnings={warningsOf(step)} />}

        <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
          <Button type="button" variant="ghost" disabled={index === 0} onClick={() => setStep(STEPS[index - 1]!)}>
            <ArrowLeft />
            {t("auto.builder.back")}
          </Button>
          {step !== "access" ? (
            <Button type="button" onClick={() => setStep(STEPS[index + 1]!)}>
              {t("auto.builder.next")}
              <ArrowRight />
            </Button>
          ) : (
            <Button type="button" disabled={busy || !report || report.errors.length > 0} onClick={() => void save()}>
              {busy && <Loader2 className="animate-spin" />}
              {automationId ? t("auto.builder.saveVersion") : t("auto.builder.create")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, lead, children, aside }: { title: string; lead?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-5 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {lead && <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{lead}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

type StepProps = { draft: Draft; set: (p: Partial<Draft>) => void }

function ChoiceCard({ selected, onSelect, icon, title, body }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background", selected ? "text-primary" : "text-muted-foreground")}>{icon}</span>
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{body}</span>
      </span>
    </button>
  )
}

function ChannelStep({ draft, set }: StepProps) {
  const { t } = useT()
  const f = draft.trigger.filters ?? {}
  const setFilter = (k: keyof NonNullable<Draft["trigger"]["filters"]>, v: string) => set({ trigger: { ...draft.trigger, filters: { ...f, [k]: v } } })
  const email = draft.trigger.channel === "email"
  return (
    <Section title={t("auto.step.channel")} lead={t("auto.channel.lead")}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="a-name">{t("common.name")}</FieldLabel>
          <Input id="a-name" value={draft.name} maxLength={120} placeholder={t("auto.channel.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="a-desc">{t("common.description")}</FieldLabel>
          <Input id="a-desc" value={draft.description ?? ""} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </FieldGroup>
      <div role="radiogroup" aria-label={t("auto.channel.title")} className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          selected={email}
          onSelect={() => set({ trigger: { ...draft.trigger, channel: "email", emailSource: draft.trigger.emailSource ?? "resend" } })}
          icon={<Mail className="size-4" />}
          title={t("auto.channel.email")}
          body={t("auto.channel.emailBody")}
        />
        <ChoiceCard
          selected={!email}
          onSelect={() => {
            const { emailSource: _drop, inboxId: _inbox, ...rest } = draft.trigger
            set({ trigger: { ...rest, channel: "webhook" } })
          }}
          icon={<Webhook className="size-4" />}
          title={t("auto.channel.webhook")}
          body={t("auto.channel.webhookBody")}
        />
      </div>
      {email && (
        <Field>
          <FieldLabel htmlFor="a-source">{t("auto.channel.source")}</FieldLabel>
          <Select
            value={draft.trigger.emailSource ?? "resend"}
            onValueChange={(v) => {
              const { inboxId: _inbox, ...rest } = draft.trigger
              set({ trigger: v === "resend" ? { ...draft.trigger, emailSource: "resend" } : { ...rest, emailSource: "webhook" } })
            }}
          >
            <SelectTrigger id="a-source" className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resend">{t("auto.channel.source.resend")}</SelectItem>
              <SelectItem value="webhook">{t("auto.channel.source.webhook")}</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>{t(draft.trigger.emailSource === "webhook" ? "auto.channel.source.webhookHint" : "auto.channel.source.resendHint")}</FieldDescription>
        </Field>
      )}
      {email && (draft.trigger.emailSource ?? "resend") === "resend" && (
        <InboxPicker
          value={draft.trigger.inboxId}
          onChange={(inboxId) => {
            const { inboxId: _old, ...rest } = draft.trigger
            set({ trigger: inboxId ? { ...rest, inboxId } : rest })
          }}
        />
      )}
      <div className="grid gap-3">
        <div>
          <h3 className="text-sm font-medium">{t("auto.filters.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("auto.filters.lead")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="f-from">{t("auto.filters.from")}</FieldLabel>
            <Input id="f-from" value={f.fromContains ?? ""} placeholder="@klientas.lt" onChange={(e) => setFilter("fromContains", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="f-subject">{t("auto.filters.subject")}</FieldLabel>
            <Input id="f-subject" value={f.subjectContains ?? ""} placeholder={t("auto.filters.subjectPlaceholder")} onChange={(e) => setFilter("subjectContains", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="f-text">{t("auto.filters.text")}</FieldLabel>
            <Input id="f-text" value={f.textContains ?? ""} onChange={(e) => setFilter("textContains", e.target.value)} />
          </Field>
          {!email && (
            <Field>
              <FieldLabel htmlFor="f-form">{t("auto.filters.form")}</FieldLabel>
              <Input id="f-form" value={f.formId ?? ""} placeholder="contact" onChange={(e) => setFilter("formId", e.target.value)} />
            </Field>
          )}
        </div>
      </div>
    </Section>
  )
}

const INQUIRY_PRESET: AutomationField[] = [
  { name: "name", type: "string", required: true, description: "Kliento vardas ir pavardė arba įmonė" },
  { name: "email", type: "email", required: false, description: "Kliento el. paštas (jei nėra tekste – siuntėjo adresas)" },
  { name: "phone", type: "phone", required: false },
  { name: "product", type: "string", required: false, description: "Ko klientas nori (produktas ar paslauga)" },
  { name: "quantity", type: "number", required: false },
  { name: "due", type: "date", required: false, description: "Pageidaujamas terminas" },
]

function ExtractStep({ draft, set }: StepProps) {
  const { t } = useT()
  const fields = draft.extract.fields
  const setFields = (next: AutomationField[]) => set({ extract: { ...draft.extract, fields: next } })
  const patch = (i: number, p: Partial<AutomationField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)))
  return (
    <>
      <Section title={t("auto.step.extract")} lead={t("auto.extract.lead")}>
        <Field>
          <FieldLabel htmlFor="a-instr">{t("auto.extract.instructions")}</FieldLabel>
          <Textarea
            id="a-instr"
            rows={4}
            maxLength={4000}
            value={draft.extract.instructions}
            placeholder={t("auto.extract.instructionsPlaceholder")}
            onChange={(e) => set({ extract: { ...draft.extract, instructions: e.target.value } })}
          />
        </Field>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">{t("auto.extract.fields")}</h3>
              <p className="text-sm text-muted-foreground">{t("auto.extract.fieldsLead")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFields(INQUIRY_PRESET)}>
              <Sparkles />
              {t("auto.extract.preset")}
            </Button>
          </div>
          <ul className="grid gap-2">
            {fields.map((f, i) => (
              <li key={i} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,10rem)_9rem_minmax(0,1fr)_auto] sm:items-center">
                <Input aria-label={t("auto.extract.fieldName")} value={f.name} className="font-mono text-[13px]" placeholder="email" onChange={(e) => patch(i, { name: e.target.value.replace(/\s+/g, "_") })} />
                <Select value={f.type} onValueChange={(v) => patch(i, { type: v as AutomationField["type"], ...(v === "enum" ? { options: f.options ?? [] } : {}) })}>
                  <SelectTrigger aria-label={t("auto.extract.fieldType")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTOMATION_FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`auto.type.${type}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input aria-label={t("common.description")} value={f.description ?? ""} placeholder={t("auto.extract.fieldDescription")} onChange={(e) => patch(i, { description: e.target.value })} />
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch size="sm" checked={f.required} onCheckedChange={(v) => patch(i, { required: v })} />
                    {t("auto.extract.required")}
                  </label>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("auto.extract.removeField")} onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                {f.type === "enum" && (
                  <Input
                    className="sm:col-span-4"
                    aria-label={t("auto.extract.options")}
                    placeholder={t("auto.extract.optionsPlaceholder")}
                    defaultValue={(f.options ?? []).join(", ")}
                    onBlur={(e) => patch(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
                  />
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="justify-self-start" disabled={fields.length >= 30} onClick={() => setFields([...fields, { name: "", type: "string", required: false }])}>
            <Plus />
            {t("auto.extract.addField")}
          </Button>
        </div>
      </Section>
      <TestPanel instructions={draft.extract.instructions} fields={fields} />
    </>
  )
}

/** "Išbandyti": the extraction of a pasted sample (dry run, nothing is stored). */
export function TestPanel({ instructions, fields }: { instructions: string; fields: AutomationField[] }) {
  const { t } = useT()
  const test = useConvexAction(api.automations.testExtract)
  const { run, busy } = useAction()
  const [sample, setSample] = useState("")
  const [subject, setSubject] = useState("")
  const [from, setFrom] = useState("")
  const [result, setResult] = useState<ExtractionResult | null>(null)
  return (
    <Section title={t("auto.test.title")} lead={t("auto.test.lead")} aside={<FlaskConical className="size-5 text-muted-foreground" aria-hidden />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="t-from">{t("auto.test.from")}</FieldLabel>
          <Input id="t-from" value={from} placeholder="jonas@example.com" onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="t-subject">{t("auto.test.subject")}</FieldLabel>
          <Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="t-sample">{t("auto.test.sample")}</FieldLabel>
        <Textarea id="t-sample" rows={6} value={sample} placeholder={t("auto.test.samplePlaceholder")} onChange={(e) => setSample(e.target.value)} />
      </Field>
      <div>
        <Button type="button" variant="secondary" disabled={busy || !sample.trim() || !instructions.trim() || !fields.length} onClick={() => void run(() => test({ instructions, fields, sample, subject, from })).then((r) => r && setResult(r))}>
          {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          {t("auto.test.run")}
        </Button>
      </div>
      {result && (
        <div className="grid gap-3" aria-live="polite">
          {result.error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {result.error.message}
            </p>
          )}
          {result.values && (
            <dl className="divide-y overflow-hidden rounded-lg border">
              {fields.map((f) => (
                <div key={f.name} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
                  <dt className="truncate font-mono text-[13px] text-muted-foreground">{f.name}</dt>
                  <dd className="break-words">{showValue(result.values?.[f.name])}</dd>
                </div>
              ))}
            </dl>
          )}
          <Problems errors={result.errors} />
          <p className="text-xs text-muted-foreground">
            {t("auto.test.meta")
              .replace("{model}", result.model)
              .replace("{ms}", String(result.durationMs))
              .replace("{tokens}", String(result.usage.inputTokens + result.usage.outputTokens))
              .replace("{attempts}", String(result.attempts))}
          </p>
        </div>
      )}
    </Section>
  )
}

function InsertStep({ draft, set, targets }: StepProps & { targets: TargetView[] | undefined }) {
  const { t } = useT()
  const setAction = (i: number, a: Draft["actions"][number]) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) })
  const pick = (i: number, targetId: string) => {
    const target = targets?.find((x) => x.id === targetId)
    const mapping: Record<string, string> = {}
    for (const k of target?.keys ?? []) {
      const s = suggest(k.key, draft.extract.fields, i > 0)
      if (s && (k.required || draft.extract.fields.some((f) => `{{${f.name}}}` === s) || s.startsWith("{{previous."))) mapping[k.key] = s
    }
    const next = { targetId, mapping }
    set({ actions: i < draft.actions.length ? draft.actions.map((x, j) => (j === i ? next : x)) : [...draft.actions, next] })
  }
  return (
    <Section title={t("auto.step.insert")} lead={t("auto.insert.lead")}>
      {targets?.length === 0 && <p className="text-sm text-muted-foreground">{t("auto.insert.noTargets")}</p>}
      <ol className="grid gap-4">
        {draft.actions.map((a, i) => (
          <li key={i} className="grid gap-4 rounded-xl border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{t(i === 0 ? "auto.insert.first" : "auto.insert.second")}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}>
                <Trash2 />
                {t("auto.insert.remove")}
              </Button>
            </div>
            <TargetSelect targets={targets} value={a.targetId} onChange={(v) => pick(i, v)} />
            <MappingEditor target={targets?.find((x) => x.id === a.targetId)} mapping={a.mapping} fields={draft.extract.fields} second={i > 0} onChange={(mapping) => setAction(i, { ...a, mapping })} />
          </li>
        ))}
      </ol>
      {draft.actions.length === 0 && <TargetSelect targets={targets} value="" onChange={(v) => pick(0, v)} />}
      {draft.actions.length === 1 && (
        <div className="grid gap-2 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">{t("auto.insert.chainHint")}</p>
          <div className="max-w-md">
            <TargetSelect targets={targets} value="" placeholder={t("auto.insert.addSecond")} onChange={(v) => pick(1, v)} />
          </div>
        </div>
      )}
    </Section>
  )
}

function TargetSelect({ targets, value, onChange, placeholder }: { targets: TargetView[] | undefined; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useT()
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={t("auto.insert.target")} className="w-full">
        <SelectValue placeholder={placeholder ?? t("auto.insert.pickTarget")} />
      </SelectTrigger>
      <SelectContent>
        {(targets ?? []).map((x) => (
          <SelectItem key={x.id} value={x.id}>
            <span className="grid text-left">
              <span>{targetLabel(t, x.id)}</span>
              <span className="text-xs text-muted-foreground">{x.id}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MappingEditor({
  target,
  mapping,
  fields,
  second,
  onChange,
}: {
  target: TargetView | undefined
  mapping: Record<string, string | number | boolean | null>
  fields: AutomationField[]
  second: boolean
  onChange: (m: Record<string, string | number | boolean | null>) => void
}) {
  const { t } = useT()
  if (!target) return null
  const setKey = (key: string, value: string) => {
    const next = { ...mapping }
    if (value === "") delete next[key]
    else next[key] = value
    onChange(next)
  }
  const placeholders = [
    ...fields.filter((f) => f.name).map((f) => ({ value: `{{${f.name}}}`, label: f.name, group: "fields" })),
    ...MESSAGE_KEYS.map((k) => ({ value: `{{message.${k}}}`, label: `message.${k}`, group: "message" })),
    ...(second ? [{ value: "{{previous.customerId}}", label: "previous.customerId", group: "previous" }] : []),
  ]
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">{target.description}</p>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {target.keys.map((k) => {
          const value = mapping[k.key]
          return (
            <li key={k.key} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="text-[13px]">{k.key}</code>
                  {k.required && <Badge variant="secondary">{t("auto.extract.required")}</Badge>}
                </div>
                <p className="truncate text-xs text-muted-foreground" title={k.description ?? undefined}>
                  {k.type}
                  {k.enum ? `: ${k.enum.join(" | ")}` : ""}
                  {k.description ? ` · ${k.description}` : ""}
                </p>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <Input
                  aria-label={k.key}
                  className="font-mono text-[13px]"
                  value={value === null || value === undefined ? "" : String(value)}
                  placeholder={k.required ? t("auto.insert.mapRequired") : t("auto.insert.mapOptional")}
                  onChange={(e) => setKey(k.key, e.target.value)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-sm" variant="outline" aria-label={t("auto.insert.insertPlaceholder")}>
                      <Braces />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                    {(["fields", "message", "previous"] as const).map((g) => {
                      const items = placeholders.filter((p) => p.group === g)
                      if (!items.length) return null
                      return (
                        <div key={g}>
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t(`auto.insert.group.${g}` as MessageKey)}</DropdownMenuLabel>
                          {items.map((p) => (
                            <DropdownMenuItem key={p.value} onSelect={() => setKey(k.key, p.value)} className="font-mono text-[13px]">
                              {p.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                        </div>
                      )
                    })}
                    {k.enum &&
                      k.enum.map((o) => (
                        <DropdownMenuItem key={o} onSelect={() => setKey(k.key, o)}>
                          {o}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AccessStep({
  draft,
  set,
  roles,
  autoRoles,
  setAutoRoles,
  autoModeOn,
  targets,
  errors,
  warnings,
}: StepProps & {
  roles: { id: string; name: string; description: string; grantsTargets: string[] }[] | undefined
  autoRoles: boolean
  setAutoRoles: (v: boolean) => void
  autoModeOn: boolean
  targets: TargetView[] | undefined
  errors: string[]
  warnings: string[]
}) {
  const { t } = useT()
  const needed = useMemo(() => draft.actions.map((a) => a.targetId), [draft.actions])
  const toggle = (id: string, on: boolean) => set({ roleIds: on ? [...new Set([...draft.roleIds, id])] : draft.roleIds.filter((r) => r !== id) })
  return (
    <>
      <Section title={t("auto.access.title")} lead={t("auto.access.lead")}>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox checked={autoRoles} onCheckedChange={(v) => setAutoRoles(v === true)} className="mt-0.5" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{t("auto.access.autoRoles")}</span>
            <span className="text-sm text-muted-foreground">{t("auto.access.autoRolesBody")}</span>
          </span>
        </label>
        {!autoRoles && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {(roles ?? []).map((r) => (
              <li key={r.id}>
                <label className="flex h-full items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                  <Checkbox checked={draft.roleIds.includes(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} className="mt-0.5" />
                  <span className="grid min-w-0 gap-1">
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.grantsTargets.filter((x) => needed.includes(x)).length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {r.grantsTargets
                          .filter((x) => needed.includes(x))
                          .map((x) => (
                            <Badge key={x} variant="secondary">
                              {targetLabel(t, x)}
                            </Badge>
                          ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div role="radiogroup" aria-label={t("auto.mode.title")} className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard selected={draft.mode === "review"} onSelect={() => set({ mode: "review" })} icon={<Sparkles className="size-4" />} title={t("auto.mode.review")} body={t("auto.mode.reviewBody")} />
          <button
            type="button"
            role="radio"
            aria-checked={draft.mode === "auto"}
            disabled={!autoModeOn}
            onClick={() => set({ mode: "auto" })}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
              draft.mode === "auto" && "border-primary bg-primary/5 ring-1 ring-primary",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
              <ArrowRight className="size-4" />
            </span>
            <span className="grid gap-0.5">
              <span className="font-medium">{t("auto.mode.auto")}</span>
              <span className="text-sm text-muted-foreground">{t(autoModeOn ? "auto.mode.autoBody" : "auto.mode.autoOff")}</span>
            </span>
          </button>
        </div>
      </Section>
      <Section title={t("auto.summary.title")}>
        <Summary draft={draft} targets={targets} />
        <Problems errors={errors} warnings={warnings} />
      </Section>
    </>
  )
}

export function Summary({ draft, targets }: { draft: AutomationDefinition & { mode?: AutomationMode }; targets?: TargetView[] | undefined }) {
  const { t } = useT()
  const channel = draft.trigger.channel === "email" ? t("auto.channel.email") : t("auto.channel.webhook")
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{t("common.name")}</dt>
      <dd className="font-medium">{draft.name || "—"}</dd>
      <dt className="text-muted-foreground">{t("auto.step.channel")}</dt>
      <dd>
        {channel}
        {Object.entries(draft.trigger.filters ?? {})
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Badge key={k} variant="outline" className="ml-2">
              {t(`auto.filters.short.${k}` as MessageKey)}: {v}
            </Badge>
          ))}
      </dd>
      <dt className="text-muted-foreground">{t("auto.extract.fields")}</dt>
      <dd className="flex flex-wrap gap-1.5">
        {draft.extract.fields.map((f) => (
          <Badge key={f.name} variant={f.required ? "default" : "secondary"}>
            {f.name} · {t(`auto.type.${f.type}` as MessageKey)}
          </Badge>
        ))}
      </dd>
      <dt className="text-muted-foreground">{t("auto.step.insert")}</dt>
      <dd>
        <ol className="grid gap-1">
          {draft.actions.map((a, i) => (
            <li key={i}>
              {i + 1}. {targetLabel(t, a.targetId)}
              {targets && !targets.some((x) => x.id === a.targetId) && <span className="ml-2 text-destructive">({t("auto.insert.missingTarget")})</span>}
            </li>
          ))}
        </ol>
      </dd>
      {draft.mode && (
        <>
          <dt className="text-muted-foreground">{t("auto.mode.title")}</dt>
          <dd>{t(draft.mode === "auto" ? "auto.mode.auto" : "auto.mode.review")}</dd>
        </>
      )}
    </dl>
  )
}

export { problemsFor }
