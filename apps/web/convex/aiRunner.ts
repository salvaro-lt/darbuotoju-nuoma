"use node"
// Node runner of the AI assistant (Mastra, OpenAI-compatible Chat Completions API).
// Reads OPENAI_BASE_URL (9Router), OPENAI_API_KEY and AI_MODEL from the Convex
// deployment env; without the key every answer ends with "AI model is not configured".
import { defineAiRunner } from "@digimuza/system-core/ai/runner"
import { aiOptions } from "./aiConfig"

export const { runAgent } = defineAiRunner(aiOptions)
