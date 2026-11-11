"use client"
import { useMutation } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { useAction } from "@/components/app/use-action"
import { aiApi } from "@/lib/ai/api"

/**
 * `/app/ai?prompt=…` (e.g. "Sukurti su AI asistentu" on the automations page): opens a
 * new conversation with the prompt in the composer. The person reads it and sends it.
 */
export function AiPromptStarter() {
  const params = useSearchParams()
  const router = useRouter()
  const create = useMutation(aiApi.createThread)
  const { run } = useAction()
  const started = useRef(false)
  const prompt = params.get("prompt")

  useEffect(() => {
    if (!prompt || started.current) return
    started.current = true
    void run(() => create({})).then((res) => {
      if (res) router.replace(`/app/ai/${res.threadId}?prompt=${encodeURIComponent(prompt.slice(0, 4000))}`)
    })
  }, [prompt, create, run, router])

  return null
}
