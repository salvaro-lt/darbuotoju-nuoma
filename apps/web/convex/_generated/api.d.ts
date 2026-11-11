/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as aiConfig from "../aiConfig.js";
import type * as aiRunner from "../aiRunner.js";
import type * as automations from "../automations.js";
import type * as automationsConfig from "../automationsConfig.js";
import type * as compliance from "../compliance.js";
import type * as crm from "../crm.js";
import type * as crmBlueprint from "../crmBlueprint.js";
import type * as crmDemo from "../crmDemo.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as finance from "../finance.js";
import type * as ingest from "../ingest.js";
import type * as invoicing from "../invoicing.js";
import type * as logistics from "../logistics.js";
import type * as mail from "../mail.js";
import type * as mailTools from "../mailTools.js";
import type * as mcp from "../mcp.js";
import type * as model_aiFetch from "../model/aiFetch.js";
import type * as model_mailTables from "../model/mailTables.js";
import type * as model_n8nClient from "../model/n8nClient.js";
import type * as model_n8nConsumer from "../model/n8nConsumer.js";
import type * as model_n8nNodes from "../model/n8nNodes.js";
import type * as model_n8nTables from "../model/n8nTables.js";
import type * as n8n from "../n8n.js";
import type * as n8nAiTools from "../n8nAiTools.js";
import type * as n8nSetup from "../n8nSetup.js";
import type * as notifications from "../notifications.js";
import type * as replies from "../replies.js";
import type * as roleAdmin from "../roleAdmin.js";
import type * as search from "../search.js";
import type * as staffing from "../staffing.js";
import type * as system from "../system.js";
import type * as teams from "../teams.js";
import type * as timesheets from "../timesheets.js";
import type * as toolGateway from "../toolGateway.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiConfig: typeof aiConfig;
  aiRunner: typeof aiRunner;
  automations: typeof automations;
  automationsConfig: typeof automationsConfig;
  compliance: typeof compliance;
  crm: typeof crm;
  crmBlueprint: typeof crmBlueprint;
  crmDemo: typeof crmDemo;
  crons: typeof crons;
  documents: typeof documents;
  finance: typeof finance;
  ingest: typeof ingest;
  invoicing: typeof invoicing;
  logistics: typeof logistics;
  mail: typeof mail;
  mailTools: typeof mailTools;
  mcp: typeof mcp;
  "model/aiFetch": typeof model_aiFetch;
  "model/mailTables": typeof model_mailTables;
  "model/n8nClient": typeof model_n8nClient;
  "model/n8nConsumer": typeof model_n8nConsumer;
  "model/n8nNodes": typeof model_n8nNodes;
  "model/n8nTables": typeof model_n8nTables;
  n8n: typeof n8n;
  n8nAiTools: typeof n8nAiTools;
  n8nSetup: typeof n8nSetup;
  notifications: typeof notifications;
  replies: typeof replies;
  roleAdmin: typeof roleAdmin;
  search: typeof search;
  staffing: typeof staffing;
  system: typeof system;
  teams: typeof teams;
  timesheets: typeof timesheets;
  toolGateway: typeof toolGateway;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
