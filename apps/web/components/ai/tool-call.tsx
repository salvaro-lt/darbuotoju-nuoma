"use client"
import type { ToolCallMessagePartProps } from "@assistant-ui/react"
import { AlertCircle, Ban, Check, ChevronRight, Loader2, ShieldAlert, X } from "lucide-react"
import { useState } from "react"
import { StatusBadge, type StatusTone } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { ToolCallState } from "@/lib/ai/types"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { useAiTool } from "./ai-context"
import { HtmlCard } from "./html-card"
import { argLabel, argValue, errorText, pretty, toolLabel, toolModule } from "./format"
import type { AiToolArtifact } from "./use-ai-runtime"

/** Built-in display tool of the ai module (see @digimuza/system-core/ai/card). */
const AI_SHOW_CARD = "ai.show_card"

const TONE: Record<ToolCallState, StatusTone> = {
  "awaiting-approval": "neutral",
  approved: "neutral",
  running: "neutral",
  done: "positive",
  rejected: "ended",
  error: "failed",
}

function stateOf(p: ToolCallMessagePartProps): ToolCallState {
  const a = p.artifact as AiToolArtifact | undefined
  if (a?.state) return a.state
  if (p.isError) return "error"
  return p.result !== undefined ? "done" : "running"
}

function StateIcon({ state }: { state: ToolCallState }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3"
  if (state === "done")
    return (
      <span className={cn(base, "bg-primary/15 text-primary")}>
        <Check strokeWidth={3} />
      </span>
    )
  if (state === "error")
    return (
      <span className={cn(base, "bg-destructive/15 text-destructive")}>
        <AlertCircle strokeWidth={2.5} />
      </span>
    )
  if (state === "rejected")
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Ban strokeWidth={2.5} />
      </span>
    )
  return (
    <span className={cn(base, "bg-muted text-muted-foreground")}>
      <Loader2 className="animate-spin" />
    </span>
  )
}

/** Labeled arguments (approval card). */
function ArgsList({ args }: { args: Record<string, unknown> }) {
  const { t, locale } = useT()
  const entries = Object.entries(args ?? {})
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t("ai.tool.noArgs")}</p>
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{argLabel(t, k)}</dt>
          <dd className="min-w-0 font-medium break-words tabular-nums">{argValue(k, v, locale)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One-line summary of the argument values ("SMOKE-1 · UAB Testas · 42,00 €"). */
function useInlineArgs(args: Record<string, unknown>) {
  const { locale } = useT()
  return Object.entries(args ?? {})
    .slice(0, 3)
    .map(([k, v]) => argValue(k, v, locale))
    .filter(Boolean)
    .join(" · ")
}

/**
 * One tool-call part. Finished calls collapse to a quiet one-line row (open it
 * for input / result / error); a call waiting for the user is an approval card.
 */
export function ToolCallCard(props: ToolCallMessagePartProps) {
  const { t } = useT()
  const tool = useAiTool(props.toolName)
  const state = stateOf(props)
  const artifact = props.artifact as AiToolArtifact | undefined
  const error = artifact?.error ?? null
  const [answering, setAnswering] = useState<"approve" | "reject" | null>(null)
  const awaiting = state === "awaiting-approval" && props.approval?.approved === undefined
  const label = toolLabel(t, props.toolName)
  const moduleId = toolModule(props.toolName)
  const inline = useInlineArgs(props.args)

  async function answer(approved: boolean) {
    setAnswering(approved ? "approve" : "reject")
    try {
      await props.respondToApproval({ approved })
    } finally {
      setAnswering(null)
    }
  }

  const sections = (
    <div className="grid gap-2">
      <Section label={t("ai.tool.args")} value={pretty(props.args)} />
      {state === "done" && props.result !== undefined && <Section label={t("ai.tool.result")} value={pretty(props.result)} />}
      {error && <Section label={t("ai.tool.errorDetail")} value={errorText(t, error)} destructive />}
    </div>
  )

  if (props.toolName === AI_SHOW_CARD && state !== "error" && state !== "rejected") {
    const a = (props.args ?? {}) as { title?: unknown; html?: unknown }
    return <HtmlCard id={props.toolCallId} title={typeof a.title === "string" ? a.title : undefined} html={typeof a.html === "string" ? a.html : ""} ready={state === "done"} />
  }

  if (awaiting) {
    return (
      <div role="group" aria-label={t("ai.approval.title")} className="my-3 animate-rise-in">
        <div className="animate-attention overflow-hidden rounded-xl border border-primary/40 bg-card text-card-foreground shadow-sm [animation-delay:var(--duration-slow)]">
        <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-sm font-medium">
          <ShieldAlert className="size-4 shrink-0 text-primary" />
          {t("ai.approval.title")}
        </div>
        <div className="grid gap-4 p-4">
          <div className="grid gap-1">
            <p className="text-base font-semibold">{label}</p>
            {tool?.description && <p className="text-sm text-muted-foreground">{tool.description}</p>}
          </div>
          <ArgsList args={props.args} />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={answering !== null} onClick={() => void answer(true)}>
              {answering === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
              {t("ai.approval.approve")}
            </Button>
            <Button variant="outline" disabled={answering !== null} onClick={() => void answer(false)}>
              {answering === "reject" ? <Loader2 className="animate-spin" /> : <X />}
              {t("ai.approval.reject")}
            </Button>
          </div>
        </div>
        </div>
      </div>
    )
  }

  const decision = artifact?.decision
  const decided =
    decision && (state === "rejected" || state === "approved" || state === "running" || state === "done" || state === "error")
      ? [
          decision.by === "mcp"
            ? t(state === "rejected" ? "ai.decision.mcpRejected" : "ai.decision.mcpApproved").replace("{client}", decision.clientName ?? "MCP")
            : t(state === "rejected" ? "ai.decision.userRejected" : "ai.decision.userApproved"),
          decision.reason ? t("ai.decision.reason").replace("{reason}", decision.reason) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null

  return (
    <Collapsible className="group/tool my-2 animate-fade-in rounded-lg border bg-muted/30 text-sm">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
        <StateIcon state={state} />
        <span className="shrink-0 font-medium">{label}</span>
        {inline && <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">{inline}</span>}
        {!inline && <span className="flex-1" />}
        {state !== "done" && <StatusBadge tone={TONE[state]}>{t(`ai.tool.state.${state}` as MessageKey)}</StatusBadge>}
        <ChevronRight aria-label={t("ai.tool.details")} className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-base) ease-out group-data-[state=open]/tool:rotate-90" />
      </CollapsibleTrigger>
      {decided && <p className={cn("px-3 pb-2 text-xs", decision?.by === "mcp" ? "text-primary" : "text-muted-foreground")}>{decided}</p>}
      <CollapsibleContent>
        <div className="grid gap-2 border-t px-3 py-3">
          <p className="font-mono text-xs text-muted-foreground">
            {moduleId && <span className="uppercase">{moduleId} · </span>}
            {props.toolName}
          </p>
          {sections}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Section({ label, value, destructive }: { label: string; value: string; destructive?: boolean }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className={cn("max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap break-words", destructive && "text-destructive")}>{value}</pre>
    </div>
  )
}
