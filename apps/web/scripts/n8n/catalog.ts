// Curated n8n node catalogue for the instance at n8n.digimuza.ai (n8n 2.1.5).
//
// Verified against the node type descriptions shipped with n8n 2.1.5
// (n8n-nodes-base@2.1.4 and @n8n/n8n-nodes-langchain@2.1.4, dist/types/nodes.json):
// `typeVersion` is the newest version of each node in that release, and every
// parameter name in `example` exists at that version. Plain data, no imports,
// so it can be copied into the Convex bundle (convex/model/n8nNodes.ts).
//
// Sub-nodes of the AI Agent (chat model, tools) connect to the agent with
// `ai_languageModel` / `ai_tool` connections instead of `main`.

export interface N8nNodeCatalogEntry {
  /** Display name in the n8n editor. */
  name: string
  /** Node type, as in workflow JSON. */
  type: string
  /** Newest version in n8n 2.1.5. */
  typeVersion: number
  /** All versions available in n8n 2.1.5. */
  versions: number[]
  kind: "trigger" | "action" | "flow" | "ai" | "ai-sub"
  purpose: string
  /** Credential type(s) the node can use, if any. */
  credentials?: string[]
  /** Minimal `parameters` for this typeVersion. */
  example: Record<string, unknown>
  /** How it connects (for sub-nodes) or other gotchas. */
  notes?: string
}

export const N8N_VERSION = "2.1.5"

export const N8N_NODE_CATALOG: readonly N8nNodeCatalogEntry[] = [
  {
    name: "Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    versions: [1, 1.1, 2, 2.1],
    kind: "trigger",
    purpose: "Starts the workflow on an HTTP request to /webhook/<path> (production) or /webhook-test/<path>.",
    credentials: ["httpHeaderAuth", "httpBasicAuth", "jwtAuth"],
    example: { httpMethod: "POST", path: "my-hook", authentication: "headerAuth", responseMode: "onReceived", options: {} },
    notes:
      "Give the node a stable `webhookId` (UUID). Output item: { headers, params, query, body }. responseMode: onReceived | lastNode | responseNode | streaming. options.rawBody keeps the raw body (for HMAC checks).",
  },
  {
    name: "Schedule Trigger",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.3,
    versions: [1, 1.1, 1.2, 1.3],
    kind: "trigger",
    purpose: "Starts the workflow on a schedule (interval or cron).",
    example: { rule: { interval: [{ field: "cronExpression", expression: "0 8 * * 1-5" }] } },
    notes: "Interval fields: seconds|minutes|hours|days|weeks|months|cronExpression with secondsInterval, minutesInterval, hoursInterval, daysInterval, triggerAtHour, triggerAtMinute…",
  },
  {
    name: "Manual Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    versions: [1],
    kind: "trigger",
    purpose: "Starts the workflow when 'Execute workflow' is clicked in the editor (testing).",
    example: {},
  },
  {
    name: "HTTP Request",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.3,
    versions: [1, 2, 3, 4, 4.1, 4.2, 4.3],
    kind: "action",
    purpose: "Calls any HTTP API (e.g. POST ${SITE_URL}/api/v1/tools/<toolId> with the agent key).",
    credentials: ["httpBearerAuth", "httpHeaderAuth", "<any predefined credential type>"],
    example: {
      method: "POST",
      url: "https://example.com/api/v1/tools/staffing.list_workers",
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ query: $json.query }) }}",
      options: {},
    },
  },
  {
    name: "Code",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    versions: [1, 2],
    kind: "action",
    purpose: "Runs JavaScript (or Python) over the items.",
    example: { mode: "runOnceForAllItems", language: "javaScript", jsCode: "return $input.all().map((i) => ({ json: { ...i.json, ok: true } }))" },
    notes: "mode: runOnceForAllItems | runOnceForEachItem (then use $json and return one object).",
  },
  {
    name: "If",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    versions: [1, 2, 2.1, 2.2, 2.3],
    kind: "flow",
    purpose: "Routes each item to the true (output 0) or false (output 1) branch.",
    example: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{ id: "c1", leftValue: "={{ $json.status }}", rightValue: "new", operator: { type: "string", operation: "equals" } }],
        combinator: "and",
      },
      looseTypeValidation: false,
      options: {},
    },
    notes: "Filter version is 3 at If 2.3 (2 at 2.2). Operators: string equals|contains|startsWith|regex…, number gt|lt…, boolean true|false, exists/notExists (singleValue).",
  },
  {
    name: "Switch",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.4,
    versions: [1, 2, 3, 3.1, 3.2, 3.3, 3.4],
    kind: "flow",
    purpose: "Routes items to one of several outputs by rules or an expression.",
    example: {
      mode: "rules",
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
              conditions: [{ leftValue: "={{ $json.kind }}", rightValue: "request", operator: { type: "string", operation: "equals" } }],
              combinator: "and",
            },
            renameOutput: true,
            outputKey: "request",
          },
        ],
      },
      options: { fallbackOutput: "extra" },
    },
    notes: "mode: expression uses numberOutputs + output (={{ index }}).",
  },
  {
    name: "Edit Fields (Set)",
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    versions: [1, 2, 3, 3.1, 3.2, 3.3, 3.4],
    kind: "action",
    purpose: "Sets, renames or keeps fields on each item.",
    example: {
      mode: "manual",
      assignments: { assignments: [{ id: "a1", name: "emailId", value: "={{ $json.body.email.id }}", type: "string" }] },
      includeOtherFields: false,
      options: {},
    },
    notes: "mode raw: jsonOutput (JSON string or expression). From 3.3 use `assignments`, not `fields`.",
  },
  {
    name: "Merge",
    type: "n8n-nodes-base.merge",
    typeVersion: 3.2,
    versions: [1, 2, 2.1, 3, 3.1, 3.2],
    kind: "flow",
    purpose: "Combines items from several inputs (append, by fields, by position, SQL, choose branch).",
    example: { mode: "combine", combineBy: "combineByPosition", options: {} },
    notes: "Inputs are connected to input index 0, 1, … (numberInputs for append/position/SQL/chooseBranch).",
  },
  {
    name: "Wait",
    type: "n8n-nodes-base.wait",
    typeVersion: 1.1,
    versions: [1, 1.1],
    kind: "flow",
    purpose: "Pauses the execution for a time, until a date, or until a webhook / form call resumes it.",
    example: { resume: "timeInterval", amount: 5, unit: "minutes" },
  },
  {
    name: "Respond to Webhook",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.5,
    versions: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
    kind: "action",
    purpose: "Sends the HTTP response of a Webhook trigger whose responseMode is responseNode.",
    example: { respondWith: "json", responseBody: "={{ JSON.stringify({ ok: true }) }}", options: { responseCode: 200 } },
  },
  {
    name: "AI Agent",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 3.1,
    versions: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 3, 3.1],
    kind: "ai",
    purpose: "LLM agent that plans and calls tools (sub-nodes) until it answers.",
    example: {
      promptType: "define",
      text: "={{ $json.body.email.text }}",
      hasOutputParser: false,
      options: { systemMessage: "Tu esi …", maxIterations: 15 },
    },
    notes: "Needs one chat model on ai_languageModel; tools on ai_tool. promptType at 3.1: auto (uses $json.chatInput) | define.",
  },
  {
    name: "OpenAI Chat Model",
    type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
    typeVersion: 1.3,
    versions: [1, 1.1, 1.2, 1.3],
    kind: "ai-sub",
    purpose: "Chat model for the AI Agent; works with any OpenAI-compatible API (9Router: models `fast`, `smart`).",
    credentials: ["openAiApi"],
    example: { model: { __rl: true, mode: "id", value: "fast" }, responsesApiEnabled: false, options: {} },
    notes:
      "Connect with ai_languageModel. The base URL comes from the credential's `url` (options.baseURL overrides). responsesApiEnabled defaults to true at 1.3; set false for chat-completions proxies.",
  },
  {
    name: "MCP Client Tool",
    type: "@n8n/n8n-nodes-langchain.mcpClientTool",
    typeVersion: 1.2,
    versions: [1, 1.1, 1.2],
    kind: "ai-sub",
    purpose: "Gives the AI Agent the tools of a remote MCP server (Streamable HTTP or SSE).",
    credentials: ["httpBearerAuth", "httpHeaderAuth", "mcpOAuth2Api", "httpMultipleHeadersAuth"],
    example: { endpointUrl: "https://example.com/api/v1/mcp", serverTransport: "httpStreamable", authentication: "bearerAuth", include: "all", options: {} },
    notes:
      "Connect with ai_tool. include: all | selected (includeTools) | except (excludeTools). Tool names are passed to the model unchanged: they must match ^[a-zA-Z0-9_-]+$ (no dots) for OpenAI/Anthropic models.",
  },
  {
    name: "Send Email (SMTP)",
    type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1,
    versions: [1, 2, 2.1],
    kind: "action",
    purpose: "Sends an email over SMTP.",
    credentials: ["smtp"],
    example: { operation: "send", fromEmail: "info@example.com", toEmail: "={{ $json.to }}", subject: "Sveiki", emailFormat: "text", text: "…", options: {} },
  },
  {
    name: "Gmail",
    type: "n8n-nodes-base.gmail",
    typeVersion: 2.2,
    versions: [1, 2, 2.1, 2.2],
    kind: "action",
    purpose: "Sends, replies to, labels and reads Gmail messages and drafts.",
    credentials: ["gmailOAuth2", "googleApi"],
    example: { authentication: "oAuth2", resource: "message", operation: "send", sendTo: "={{ $json.to }}", subject: "Sveiki", emailType: "text", message: "…", options: {} },
  },
]
