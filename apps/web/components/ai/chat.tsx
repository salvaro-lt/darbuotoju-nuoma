"use client"
import { AssistantRuntimeProvider, AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState, WebSpeechDictationAdapter } from "@assistant-ui/react"
import { useQuery } from "convex/react"
import { AlertCircle, ArrowDown, ArrowUp, CircleSlash, Loader2, Mic, MicOff, Plug, Sparkles, Square } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { aiApi } from "@/lib/ai/api"
import type { AiThreadId, ThreadView } from "@/lib/ai/types"
import { formatDate } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages"
import { useAiAgents } from "./ai-context"
import { errorText, operationIdOf } from "./format"
import { MarkdownText } from "./markdown-text"
import { ThreadHeader } from "./thread-header"
import { ToolCallCard } from "./tool-call"
import { useAiRuntime, type AiMessageCustom } from "./use-ai-runtime"

/** One conversation: live messages from Convex through an assistant-ui ExternalStoreRuntime. */
export function AiChat({ threadId, leading }: { threadId: AiThreadId; leading?: ReactNode }) {
  const { t } = useT()
  const thread = useQuery(aiApi.getThread, { threadId })
  const messages = useQuery(aiApi.listMessages, { threadId })
  const runtime = useAiRuntime({ threadId, thread, messages })
  usePrefilledPrompt(runtime)

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 flex-col">
        <ThreadHeader thread={thread} leading={leading} />
        {thread?.mcp && <McpBanner thread={thread} mcp={thread.mcp} />}

        <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-3 md:px-8">
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 py-6">
            <AuiIf condition={(s) => s.thread.isLoading}>
              <div className="grid gap-3">
                <Skeleton className="ml-auto h-9 w-1/2 rounded-2xl" />
                <Skeleton className="h-16 w-3/4 rounded-2xl" />
              </div>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <Welcome />
            </AuiIf>
            <ThreadPrimitive.Messages>{({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}</ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto w-full max-w-4xl bg-background pb-4">
            <ThreadPrimitive.ScrollToBottom asChild>
              <Button variant="outline" size="icon-sm" aria-label={t("ai.scrollDown")} className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full shadow-sm disabled:invisible">
                <ArrowDown />
              </Button>
            </ThreadPrimitive.ScrollToBottom>
            {thread?.mcp ? (
              <p className="flex items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
                <Plug aria-hidden className="size-4 shrink-0 text-primary" />
                {t("ai.mcp.readOnly").replace("{client}", thread.mcp.clientName)}
              </p>
            ) : (
              <Composer />
            )}
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </div>
    </AssistantRuntimeProvider>
  )
}

/** `?prompt=…` (from AiPromptStarter): put it in the composer once, then drop it from the URL. */
function usePrefilledPrompt(runtime: { thread: { composer: { setText(text: string): void } } }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const done = useRef(false)
  const prompt = params.get("prompt")
  useEffect(() => {
    if (!prompt || done.current) return
    done.current = true
    runtime.thread.composer.setText(prompt)
    router.replace(pathname)
  }, [prompt, runtime, router, pathname])
}

/** The external client that led this thread, live. */
function McpBanner({ thread, mcp }: { thread: ThreadView; mcp: NonNullable<ThreadView["mcp"]> }) {
  const { t, locale } = useT()
  const agent = useAiAgents()?.find((a) => a.id === thread.agentId)
  const connection = t("ai.mcp.bannerConnection")
    .replace("{name}", mcp.connectionName ?? mcp.clientName)
    .replace("{date}", formatDate(mcp.connectedAt, locale))
  return (
    <div role="note" className="flex shrink-0 items-start gap-3 border-b bg-primary/5 px-3 py-2.5 text-sm md:px-6">
      <Plug aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="font-medium">{t("ai.mcp.banner").replace("{client}", mcp.clientName)}</p>
        <p className="text-xs">
          {t("ai.mcp.agent")
            .replace("{agent}", agent?.name ?? thread.agentId)
            .replace("{model}", thread.model ?? "—")}
        </p>
        <p className="text-xs text-muted-foreground">
          {connection} · {t("ai.mcp.bannerLive").replace("{client}", mcp.clientName)}
        </p>
      </div>
      <Link href="/app/settings/mcp" className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline">
        {t("ai.mcp.manage")}
      </Link>
    </div>
  )
}

function UserMessage() {
  const { t } = useT()
  const via = (useAuiState((s) => s.message.metadata.custom) as Partial<AiMessageCustom>).via
  const author = via ? t("ai.mcp.via").replace("{client}", via.clientName) : t("ai.you")
  return (
    <MessagePrimitive.Root className="flex animate-rise-in flex-col items-end gap-1" aria-label={author}>
      {via && (
        <span className="flex items-center gap-1 px-1 text-xs font-medium text-primary">
          <Plug aria-hidden className="size-3" />
          {author}
        </span>
      )}
      <div className="max-w-[min(85%,42rem)] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  const { t } = useT()
  const custom = useAuiState((s) => s.message.metadata.custom) as Partial<AiMessageCustom>
  const empty = useAuiState((s) => s.message.parts.length === 0)
  const streaming = custom.status === "streaming"
  const opId = operationIdOf(custom.error)

  return (
    <MessagePrimitive.Root className="flex animate-rise-in gap-3">
      <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-primary">
        <Sparkles className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <div className="w-full max-w-full text-foreground">
        <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Override: ToolCallCard } }} />
        {streaming && empty && (
          <p className="flex animate-fade-in items-center gap-2 text-sm text-muted-foreground [animation-delay:var(--duration-fast)]">
            <Loader2 className="size-4 animate-spin" />
            {t("ai.thinking")}
          </p>
        )}
      </div>
      {custom.status === "error" && (
        <div role="alert" className="flex w-full animate-fade-in items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="grid min-w-0 gap-0.5">
            <p className="font-medium">
              {t("ai.error")}
              {custom.error ? `: ${errorText(t, custom.error.code)}` : ""}
            </p>
            {custom.error?.message && custom.error.message !== custom.error.code && <p className="break-words">{custom.error.message}</p>}
            {opId && (
              <p className="font-mono text-xs">
                {t("state.operation")} {opId}
              </p>
            )}
          </div>
        </div>
      )}
      {custom.status === "stopped" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleSlash className="size-3" />
          {t("ai.stopped")}
        </p>
      )}
      </div>
    </MessagePrimitive.Root>
  )
}

function Composer() {
  const { t } = useT()
  const disabled = useAuiState((s) => s.thread.isDisabled)
  const voice = useVoiceSupported()
  return (
    <div className="grid gap-1.5">
      {disabled && <p className="px-1 text-xs text-muted-foreground">{t("ai.composer.waiting")}</p>}
      <ComposerPrimitive.Root className="flex items-end gap-1.5 rounded-2xl border bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[[data-dictating]]:border-primary/50">
        <div className="grid min-w-0 flex-1">
          <ComposerPrimitive.Input
            rows={1}
            autoFocus
            maxRows={8}
            placeholder={t("ai.composer.placeholder")}
            aria-label={t("ai.composer.placeholder")}
            className="min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <p data-dictating aria-live="polite" className="flex items-center gap-2 px-2 pb-1 text-sm text-muted-foreground">
              <span aria-hidden className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="min-w-0 truncate">
                <ComposerPrimitive.DictationTranscript />
              </span>
              <span className="shrink-0 text-xs">{t("ai.voice.listening")}</span>
            </p>
          </AuiIf>
        </div>
        {voice && (
          <>
            <AuiIf condition={(s) => s.composer.dictation == null}>
              <ComposerPrimitive.Dictate asChild>
                <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" aria-label={t("ai.voice.start")} title={t("ai.voice.start")}>
                  <Mic />
                </Button>
              </ComposerPrimitive.Dictate>
            </AuiIf>
            <AuiIf condition={(s) => s.composer.dictation != null}>
              <ComposerPrimitive.StopDictation asChild>
                <Button size="icon" variant="outline" className="rounded-full border-primary/50 text-primary" aria-label={t("ai.voice.stop")} title={t("ai.voice.stop")}>
                  <MicOff />
                </Button>
              </ComposerPrimitive.StopDictation>
            </AuiIf>
          </>
        )}
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button size="icon" className="rounded-full" aria-label={t("ai.send")}>
              <ArrowUp />
            </Button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button size="icon" variant="secondary" className="rounded-full" aria-label={t("ai.stop")}>
              <Square className="fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </ComposerPrimitive.Root>
      <p className="hidden px-1 text-center text-xs text-muted-foreground md:block">{t(voice ? "ai.composer.hintVoice" : "ai.composer.hint")}</p>
    </div>
  )
}

/** Whether this browser has speech recognition (checked after mount, so server and client render the same). */
const noSubscribe = () => () => {}
function useVoiceSupported() {
  return useSyncExternalStore(noSubscribe, () => WebSpeechDictationAdapter.isSupported(), () => false)
}

/** Empty conversation: who is answering, and prompts built from the tools this user can actually use. */
function Welcome() {
  const { t } = useT()
  const agents = useAiAgents()
  const toolIds = new Set((agents ?? []).flatMap((a) => a.tools.map((tool) => tool.id)))
  const prompts = [
    ...[...toolIds].map((id) => `ai.suggest.${id}`).filter((k) => k in MESSAGES.lt),
    "ai.suggest.general",
  ].map((k) => t(k as MessageKey))

  return (
    <div className="my-auto grid justify-items-center gap-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border bg-background text-primary shadow-sm">
        <Sparkles className="size-5" />
      </span>
      <div className="grid max-w-md gap-2">
        <h3 className="text-xl font-semibold tracking-tight">{t("ai.thread.empty.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("ai.thread.empty.body")}</p>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2" aria-label={t("ai.suggest.title")}>
        {prompts.map((p) => (
          <ThreadPrimitive.Suggestion key={p} prompt={p} send asChild>
            <Button variant="outline" size="sm" className="h-auto rounded-full px-3.5 py-1.5 text-left whitespace-normal font-normal">
              {p}
            </Button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  )
}
