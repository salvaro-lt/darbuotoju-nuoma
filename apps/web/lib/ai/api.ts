// The AI functions the app exports from convex/ai.ts (system-core
// AI_PUBLIC_FUNCTIONS), from the generated Convex API.
import { api } from "@/convex/_generated/api"

export const aiApi = api.ai

/** Permission that opens the AI chat (pages and nav). */
export const AI_CHAT_PERMISSION = "ai:chat:use"
/** Module id in the system-core module registry. */
export const AI_MODULE_ID = "ai"
