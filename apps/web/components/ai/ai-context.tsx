"use client"
import { createContext, useContext } from "react"
import type { AgentToolView, AgentView } from "@/lib/ai/types"

const AgentsContext = createContext<AgentView[] | undefined>(undefined)

export const AiAgentsProvider = AgentsContext.Provider

/** Agents from `listAgents` (undefined while loading). */
export function useAiAgents() {
  return useContext(AgentsContext)
}

/** Tool description for a tool call, from any agent that exposes it to the caller. */
export function useAiTool(toolName: string): AgentToolView | undefined {
  const agents = useContext(AgentsContext)
  for (const a of agents ?? []) {
    const tool = a.tools.find((t) => t.id === toolName)
    if (tool) return tool
  }
  return undefined
}
