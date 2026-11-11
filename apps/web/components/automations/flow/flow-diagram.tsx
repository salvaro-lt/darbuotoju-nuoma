"use client"
// The automation as a read-only React Flow diagram: Kanalas → AI ištraukimas →
// Veiksmas 1 → Veiksmas 2 → Rezultatas. Custom nodes (cards with a status ring), edges
// that name the data they carry, a fixed chain layout from the measured node sizes
// (left → right on desktop, top → bottom on mobile). Clicking a node calls `onSelect`.
import type { AutomationDefinition, AutomationMode } from "@digimuza/system-core/automations"
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { AlertTriangle, Check, CheckCheck, Inbox, Loader2, Mail, Minus, Sparkles, SquarePlus, Webhook, X } from "lucide-react"
import { useTheme } from "next-themes"
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { targetLabel } from "../shared"
import { edgeLabel, flowEdges, flowSteps, layoutChain, mappingRefs, stepIds, type FlowStep, type StepStatus } from "./model"

export interface FlowAutomation extends AutomationDefinition {
  mode: AutomationMode
  /** Email address or webhook URL shown on the channel node. */
  endpoint?: string | null
  /** Model of the latest run or test, if known. */
  model?: string | null
}

interface StepData extends Record<string, unknown> {
  step: FlowStep
  automation: FlowAutomation
  status: StepStatus
  durationMs: number | null
  direction: "LR" | "TB"
  selected: boolean
  onSelect?: ((id: string) => void) | undefined
}
type StepNode = Node<StepData, "step">
interface FlowEdgeData extends Record<string, unknown> {
  data: string[]
  flowing: boolean
  done: boolean
  direction: "LR" | "TB"
}
type DataEdge = Edge<FlowEdgeData, "data">

const reducedQuery = "(prefers-reduced-motion: reduce)"
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(reducedQuery)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}
/** `prefers-reduced-motion: reduce` (true during SSR: no motion until we know). */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => true)
}

const STATUS_RING: Record<StepStatus, string> = {
  idle: "border-border",
  pending: "border-border opacity-70",
  running: "border-primary ring-2 ring-primary/30",
  ok: "border-emerald-500/60",
  warning: "border-amber-500/70",
  error: "border-destructive/70",
  skipped: "border-dashed border-border opacity-60",
}

export function StatusDot({ status, className }: { status: StepStatus; className?: string }) {
  const { t } = useT()
  const label = t(`auto.flow.status.${status}` as MessageKey)
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]"
  const icon =
    status === "ok" ? (
      <span className={cn(base, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>
        <Check className="size-3" />
      </span>
    ) : status === "warning" ? (
      <span className={cn(base, "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
        <AlertTriangle className="size-3" />
      </span>
    ) : status === "error" ? (
      <span className={cn(base, "bg-destructive/15 text-destructive")}>
        <X className="size-3" />
      </span>
    ) : status === "running" ? (
      <span className={cn(base, "bg-primary/15 text-primary")}>
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
      </span>
    ) : status === "skipped" ? (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Minus className="size-3" />
      </span>
    ) : status === "pending" ? (
      <span className={cn(base, "border border-dashed border-muted-foreground/50")} />
    ) : null
  if (!icon) return null
  return (
    <span className={cn("inline-flex", className)} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  )
}

function StepIcon({ step, automation }: { step: FlowStep; automation: FlowAutomation }) {
  const Icon = step.kind === "channel" ? (automation.trigger.channel === "email" ? Mail : Webhook) : step.kind === "extract" ? Sparkles : step.kind === "action" ? SquarePlus : automation.mode === "auto" ? CheckCheck : Inbox
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-primary shadow-xs">
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

/** Title of a step ("Kanalas", "Veiksmas 1"…). */
export function stepTitle(t: (k: MessageKey) => string, step: FlowStep): string {
  if (step.kind === "action") return t("auto.flow.action").replace("{n}", String((step.index ?? 0) + 1))
  return t(`auto.flow.${step.kind}` as MessageKey)
}

function StepBody({ step, automation }: { step: FlowStep; automation: FlowAutomation }) {
  const { t } = useT()
  if (step.kind === "channel") {
    const filters = Object.entries(automation.trigger.filters ?? {}).filter(([, v]) => v)
    return (
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">{automation.trigger.channel === "email" ? t("auto.channel.email") : t("auto.channel.webhook")}</p>
        {automation.endpoint && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={automation.endpoint}>
            {automation.endpoint}
          </p>
        )}
        {filters.length ? (
          <ul className="flex flex-wrap gap-1">
            {filters.map(([k, v]) => (
              <li key={k} className="max-w-full truncate rounded-full border px-1.5 py-0.5 text-[11px]">
                {t(`auto.filters.short.${k}` as MessageKey)}: {String(v)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("auto.flow.noFilters")}</p>
        )}
      </div>
    )
  }
  if (step.kind === "extract") {
    const fields = automation.extract.fields
    return (
      <div className="grid gap-1.5">
        <p className="truncate text-[11px] text-muted-foreground">
          {t("auto.flow.model")}: <span className="font-mono">{automation.model ?? t("auto.flow.modelDefault")}</span>
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{automation.extract.instructions}</p>
        <ul className="grid gap-0.5 text-xs">
          {fields.slice(0, 6).map((f) => (
            <li key={f.name} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono">
                {f.name}
                {f.required && (
                  <span className="text-primary" aria-label={t("auto.flow.required")}>
                    *
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{t(`auto.type.${f.type}` as MessageKey)}</span>
            </li>
          ))}
          {fields.length > 6 && <li className="text-[11px] text-muted-foreground">+{fields.length - 6}</li>}
        </ul>
      </div>
    )
  }
  if (step.kind === "action") {
    const action = automation.actions[step.index ?? 0]
    if (!action) return null
    const entries = Object.entries(action.mapping)
    return (
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">{targetLabel(t, action.targetId)}</p>
        <ul className="grid gap-0.5 text-xs">
          {entries.slice(0, 5).map(([k, v]) => {
            const refs = typeof v === "string" ? mappingRefs({ v }) : []
            return (
              <li key={k} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                <span className="truncate font-mono">{k}</span>
                <span className="min-w-0 truncate text-right text-[11px] text-muted-foreground">{refs.length ? refs.join(", ") : JSON.stringify(v)}</span>
              </li>
            )
          })}
          {entries.length > 5 && <li className="text-[11px] text-muted-foreground">+{entries.length - 5}</li>}
        </ul>
      </div>
    )
  }
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{t(automation.mode === "auto" ? "auto.mode.auto" : "auto.mode.review")}</p>
      <p className="text-[11px] text-muted-foreground">{t(automation.mode === "auto" ? "auto.flow.toInsert" : "auto.flow.toReview")}</p>
    </div>
  )
}

const StepCard = memo(function StepCard({ data }: NodeProps<StepNode>) {
  const { t } = useT()
  const { step, automation, status, durationMs, direction, selected, onSelect } = data
  const title = stepTitle(t, step)
  const lr = direction === "LR"
  return (
    <div className={cn("relative", step.kind === "result" ? (lr ? "w-40" : "w-60") : lr ? "w-52" : "w-60")}>
      <Handle type="target" position={lr ? Position.Left : Position.Top} isConnectable={false} className="!size-1.5 !min-w-0 !border-0 !bg-muted-foreground/40" />
      <button
        type="button"
        onClick={() => onSelect?.(step.id)}
        aria-label={t("auto.flow.open").replace("{name}", title)}
        aria-pressed={selected}
        className={cn(
          "nodrag nopan grid w-full min-w-0 gap-2 overflow-hidden rounded-xl border bg-card p-3 text-left text-card-foreground shadow-xs transition-[box-shadow,border-color,opacity] duration-300 outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
          STATUS_RING[status],
          selected && "shadow-md ring-2 ring-primary/50",
          status === "running" && "motion-safe:animate-pulse",
        )}
      >
        <span className="flex items-center gap-2">
          <StepIcon step={step} automation={automation} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</span>
          <StatusDot status={status} />
        </span>
        <StepBody step={step} automation={automation} />
        {!!durationMs && (status === "ok" || status === "warning" || status === "error") && (
          <span className="justify-self-end font-mono text-[10px] text-muted-foreground tabular-nums">{t("auto.flow.test.ms").replace("{ms}", String(durationMs))}</span>
        )}
      </button>
      <Handle type="source" position={lr ? Position.Right : Position.Bottom} isConnectable={false} className="!size-1.5 !min-w-0 !border-0 !bg-muted-foreground/40" />
    </div>
  )
})

function DataEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<DataEdge>) {
  const { t } = useT()
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const names = data?.data ?? []
  const label = !names.length ? "" : data?.direction === "LR" ? String(names.length) : edgeLabel(names, 4)
  const full = names.join(", ")
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={cn(data?.flowing && "animated")}
        style={{ stroke: data?.flowing || data?.done ? "var(--primary)" : "var(--border)", strokeWidth: data?.flowing ? 2 : 1.5, transition: "stroke 300ms" }}
      />
      {label && (
        <EdgeLabelRenderer>
          <span
            className={cn(
              "nodrag nopan pointer-events-auto absolute truncate rounded-full border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground shadow-xs",
              data?.direction === "LR" ? "max-w-14" : "max-w-64",
              (data?.flowing || data?.done) && "border-primary/50 text-foreground",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={t("auto.flow.dataFlow").replace("{data}", full)}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { step: StepCard }
const edgeTypes = { data: DataEdgeView }

export interface FlowDiagramProps {
  automation: FlowAutomation
  statuses?: Record<string, StepStatus>
  durations?: Record<string, number>
  selectedId?: string | null
  onSelect?: (id: string) => void
  direction: "LR" | "TB"
  className?: string
}

const GAP = { LR: 60, TB: 52 }
const noop = () => {}

function Diagram({ automation, statuses = {}, durations = {}, selectedId = null, onSelect, direction, className }: FlowDiagramProps) {
  const { t } = useT()
  const { resolvedTheme } = useTheme()
  const reduced = useReducedMotion()
  const steps = useMemo(() => flowSteps(automation), [automation])
  const edgesModel = useMemo(() => flowEdges(automation), [automation])
  const { fitView } = useReactFlow<StepNode, DataEdge>()

  // Controlled nodes: React Flow reports each node's measured size; the chain layout is
  // derived from those sizes during render (estimates until measured).
  const [base, setBase] = useState<StepNode[]>(() =>
    steps.map((step) => ({ id: step.id, type: "step", position: { x: 0, y: 0 }, draggable: false, selectable: false, connectable: false, data: {} as StepData })),
  )
  const onNodesChange = useCallback((changes: NodeChange<StepNode>[]) => setBase((ns) => applyNodeChanges(changes, ns)), [])
  const boxes = base.map((n, i) => ({ width: n.measured?.width ?? (direction === "LR" ? (steps[i]?.kind === "result" ? 160 : 208) : 240), height: n.measured?.height ?? 170 }))
  const measured = base.every((n) => n.measured?.width)
  const layout = layoutChain(boxes, direction, GAP[direction])
  const layoutKey = measured ? JSON.stringify(layout) : ""
  const height = direction === "TB" ? boxes.reduce((h, b) => h + b.height, 0) + GAP.TB * (boxes.length - 1) + 32 : null

  const nodes: StepNode[] = base.map((n, i) => {
    const step = steps[i]!
    return {
      ...n,
      position: layout[i]!,
      data: { step, automation, status: statuses[step.id] ?? "idle", durationMs: durations[step.id] ?? null, direction, selected: selectedId === step.id, onSelect },
    }
  })
  const edges: DataEdge[] = useMemo(
    () =>
      edgesModel.map((e) => {
        const target = statuses[e.target]
        const source = statuses[e.source]
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "data",
          focusable: false,
          data: { data: e.data, direction, flowing: !reduced && target === "running", done: (source === "ok" || source === "warning") && !!target && target !== "pending" && target !== "skipped" && target !== "idle" },
        }
      }),
    [edgesModel, statuses, direction, reduced],
  )

  useEffect(() => {
    if (!layoutKey) return
    // After React Flow has stored the new positions (its store updates in an effect).
    const id = window.setTimeout(() => void fitView({ padding: 0.04, maxZoom: 1, duration: reduced ? 0 : 200 }), 60)
    return () => window.clearTimeout(id)
  }, [layoutKey, direction, fitView, reduced])

  return (
    <div
      role="group"
      aria-label={t("auto.flow.label")}
      className={cn("relative w-full overflow-hidden rounded-xl border bg-muted/20 [&_.react-flow__attribution]:hidden", direction === "LR" ? "h-[19rem]" : "", className)}
      style={direction === "TB" && height ? { height } : undefined}
    >
      <ReactFlow<StepNode, DataEdge>
        nodes={nodes}
        onNodesChange={onNodesChange}
        // Read-only nodes get pointer-events: none unless a node handler is set; the card's button selects.
        onNodeClick={noop}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={direction === "LR"}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={direction === "LR"}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.4}
        maxZoom={1.25}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        {direction === "LR" && <Controls
            showInteractive={false}
            position="bottom-right"
            className="overflow-hidden rounded-lg border !shadow-xs [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground [&_button:hover]:!bg-muted [&_button_svg]:!fill-current" fitViewOptions={{ padding: 0.04, maxZoom: 1 }} />}
      </ReactFlow>
    </div>
  )
}

/** The diagram with its own React Flow store. Client only. */
export function FlowDiagram(props: FlowDiagramProps) {
  return (
    <ReactFlowProvider>
      <Diagram key={`${props.direction}:${stepIds(props.automation).join()}`} {...props} />
    </ReactFlowProvider>
  )
}
