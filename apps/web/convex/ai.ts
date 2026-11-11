// The AI assistant module from @digimuza/system-core. Public functions guard
// themselves (ai:chat:use, module enabled, role view, human session, thread
// owner); internal ones are called only by the runner in convex/aiRunner.ts.
// The names are the integration contract (AI_PUBLIC_FUNCTIONS + AI_INTERNAL_FUNCTIONS).
import { defineAi } from "@digimuza/system-core/ai"
import { aiOptions } from "./aiConfig"
import { system } from "./system"

export const {
  listAgents,
  listThreads,
  getThread,
  listMessages,
  createThread,
  sendMessage,
  stopRun,
  respondToToolCall,
  renameThread,
  archiveThread,
  _startRun,
  _updateMessage,
  _appendText,
  _addToolCall,
  _executeTool,
  _setToolCallState,
  _finishRun,
  _isStopRequested,
} = defineAi(system, aiOptions).functions
