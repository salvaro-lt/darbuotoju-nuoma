// AI integrations from @digimuza/system-core/mcp: ChatGPT and Claude talk to the
// AI assistant (convex/aiConfig.ts) over MCP, connected with a one-time link.
// The "AI integrations" page calls the app functions; the route handlers in
// app/mcp and app/.well-known call the OAuth and tool functions (no session,
// the link code / tokens prove the caller). Names: MCP_*_FUNCTIONS in system-core.
import { defineMcp } from "@digimuza/system-core/mcp"
import { aiOptions } from "./aiConfig"
import { system } from "./system"

export const {
  // The "AI integrations" page (human session)
  listMcpRoles,
  createMcpLink,
  _createMcpLink,
  getMcpLinkStatus,
  listMcpConnections,
  revokeMcpConnection,
  // OAuth 2.1 (dynamic client registration, authorization code + PKCE, refresh, revocation)
  oauthRegister,
  _oauthRegister,
  oauthAuthorize,
  _oauthAuthorize,
  oauthToken,
  _oauthExchange,
  _oauthRefresh,
  oauthRevoke,
  // MCP tools (bearer token)
  mcpCheckToken,
  mcpAskAgent,
  mcpRespondToApproval,
  mcpRunStatus,
  mcpListAgents,
  mcpListThreads,
  mcpGetThread,
} = defineMcp(system, aiOptions).functions
