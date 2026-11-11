"use client"
import { useExternalStoreRuntime, WebSpeechDictationAdapter, type AppendMessage, type ThreadMessageLike } from "@assistant-ui/react"
import type { OptimisticUpdate } from "convex/browser"
import { useMutation } from "convex/react"
import type { FunctionArgs } from "convex/server"
import { useCallback, useMemo } from "react"
import { useAction } from "@/components/app/use-action"
import { aiApi } from "@/lib/ai/api"
import { useT } from "@/lib/i18n/client"
import type { AiMessageId, AiThreadId, MessagePart, MessageView, ThreadView } from "@/lib/ai/types"

/** What the UI reads back from `message.metadata.custom` (see `toThreadMessage`). */
export interface AiMessageCustom {
  status: MessageView["status"]
  error: MessageView["error"]
  /** Set on user messages an MCP client (ChatGPT, Claude…) sent for the user. */
  via: MessageView["via"]
}

/** What the UI reads back from a tool-call part's `artifact`. */
export interface AiToolArtifact {
  state: Extract<MessagePart, { type: "tool-call" }>["state"]
  error: string | null
  /** Who approved or rejected the call (the user here, or an MCP client for them). */
  decision: Extract<MessagePart, { type: "tool-call" }>["decision"] | null
}

type ToolPart = Extract<MessagePart, { type: "tool-call" }>
type LikeContent = Exclude<ThreadMessageLike["content"], string>[number]

function plainArgs(args: unknown): Record<string, never> {
  // assistant-ui wants a JSON object; wrap scalars and arrays.
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, never>
  return (args === undefined ? {} : { value: args }) as Record<string, never>
}

function toolPart(p: ToolPart): LikeContent {
  const artifact: AiToolArtifact = { state: p.state, error: p.error ?? null, decision: p.decision ?? null }
  const approval =
    p.state === "awaiting-approval" ? { id: p.toolCallId } : p.state === "approved" ? { id: p.toolCallId, approved: true } : p.state === "rejected" ? { id: p.toolCallId, approved: false } : undefined
  return {
    type: "tool-call",
    toolCallId: p.toolCallId,
    toolName: p.toolName,
    args: plainArgs(p.args),
    argsText: JSON.stringify(p.args ?? {}),
    artifact,
    ...(p.result !== undefined ? { result: p.result } : p.error ? { result: { error: p.error } } : {}),
    ...(p.state === "error" ? { isError: true } : {}),
    ...(approval ? { approval } : {}),
  }
}

/**
 * MessageView (Convex, live) → assistant-ui ThreadMessageLike.
 * - text parts → text; tool-call parts → tool-call with `approval` while the
 *   call waits for the user (id = toolCallId) and the backend `state` in `artifact`.
 * - status: streaming → running; done → complete; error → incomplete/error;
 *   stopped → incomplete/cancelled; the last assistant message of a thread that
 *   waits for approval → requires-action.
 */
export function toThreadMessage(m: MessageView, waitingApproval: boolean): ThreadMessageLike {
  const custom: AiMessageCustom = { status: m.status, error: m.error, via: m.via ?? null }
  const base = { id: m.id, createdAt: new Date(m.createdAt), metadata: { custom: { ...custom } } }
  if (m.role === "user") {
    return { ...base, role: "user", content: m.parts.flatMap((p) => (p.type === "text" ? [{ type: "text" as const, text: p.text }] : [])) }
  }
  const content = m.parts.map((p): LikeContent => (p.type === "text" ? { type: "text", text: p.text } : toolPart(p)))
  const awaiting = m.parts.some((p) => p.type === "tool-call" && p.state === "awaiting-approval")
  const status: ThreadMessageLike["status"] =
    waitingApproval && awaiting
      ? { type: "requires-action", reason: "tool-calls" }
      : m.status === "streaming"
        ? { type: "running" }
        : m.status === "error"
          ? { type: "incomplete", reason: "error", error: m.error ? { code: m.error.code, message: m.error.message } : null }
          : m.status === "stopped"
            ? { type: "incomplete", reason: "cancelled" }
            : { type: "complete", reason: "stop" }
  return { ...base, role: "assistant", content, status }
}

function textOf(message: AppendMessage) {
  return message.content
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim()
}

/** Optimistic update for sendMessage: the user's bubble and the running state show at once. */
const showSentMessage: OptimisticUpdate<FunctionArgs<typeof aiApi.sendMessage>> = (store, args) => {
  const current = store.getQuery(aiApi.listMessages, { threadId: args.threadId })
  if (current) {
    const now = Date.now()
    const optimistic: MessageView = { id: `optimistic-${now}` as AiMessageId, role: "user", parts: [{ type: "text", text: args.text }], status: "done", error: null, createdAt: now }
    store.setQuery(aiApi.listMessages, { threadId: args.threadId }, [...current, optimistic])
  }
  const t = store.getQuery(aiApi.getThread, { threadId: args.threadId })
  if (t) store.setQuery(aiApi.getThread, { threadId: args.threadId }, { ...t, status: "running" })
}

/**
 * assistant-ui ExternalStoreRuntime over the Convex live queries of one thread.
 * Messages stream in as `listMessages` updates; the composer, stop button and
 * approval buttons call the AI mutations. Errors go through `useAction()`.
 */
export function useAiRuntime({ threadId, thread, messages }: { threadId: AiThreadId; thread: ThreadView | undefined; messages: MessageView[] | undefined }) {
  const { run } = useAction()
  const send = useMutation(aiApi.sendMessage).withOptimisticUpdate(showSentMessage)
  const stop = useMutation(aiApi.stopRun)
  const respond = useMutation(aiApi.respondToToolCall)

  const waitingApproval = thread?.status === "waiting-approval"
  const lastStreaming = messages?.at(-1)?.status === "streaming"
  const convertMessage = useCallback((m: MessageView) => toThreadMessage(m, waitingApproval), [waitingApproval])

  // Voice input: the browser's own speech recognition (Chrome, Edge, Safari), in the UI language.
  // Unsupported browsers get no adapter, so the microphone button is not shown.
  const { locale } = useT()
  const dictation = useMemo(
    () => (typeof window !== "undefined" && WebSpeechDictationAdapter.isSupported() ? new WebSpeechDictationAdapter({ language: locale === "lt" ? "lt-LT" : "en-GB", continuous: true, interimResults: true }) : undefined),
    [locale],
  )

  return useExternalStoreRuntime<MessageView>({
    messages: messages ?? [],
    convertMessage,
    isLoading: messages === undefined || thread === undefined,
    isRunning: thread?.status === "running" || lastStreaming,
    // Sending is blocked while a tool call waits for the user's decision, and in threads an
    // MCP client leads (they are read-only in the app; runs there act as the connection).
    isDisabled: waitingApproval || !!thread?.mcp,
    adapters: dictation ? { dictation } : {},
    onNew: async (message) => {
      const text = textOf(message)
      if (!text) return
      await run(() => send({ threadId, text }))
    },
    onCancel: async () => {
      await run(() => stop({ threadId }))
    },
    onRespondToToolApproval: async ({ approvalId, approved }) => {
      const owner = messages?.findLast((m) => m.parts.some((p) => p.type === "tool-call" && p.toolCallId === approvalId))
      if (!owner) return
      await run(() => respond({ messageId: owner.id, toolCallId: approvalId, approve: approved }))
    },
  })
}
