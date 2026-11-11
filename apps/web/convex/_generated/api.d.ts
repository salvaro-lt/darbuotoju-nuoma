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
import type * as crm from "../crm.js";
import type * as crmBlueprint from "../crmBlueprint.js";
import type * as crmDemo from "../crmDemo.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as finance from "../finance.js";
import type * as ingest from "../ingest.js";
import type * as invoicing from "../invoicing.js";
import type * as mail from "../mail.js";
import type * as mcp from "../mcp.js";
import type * as notifications from "../notifications.js";
import type * as roleAdmin from "../roleAdmin.js";
import type * as search from "../search.js";
import type * as staffing from "../staffing.js";
import type * as system from "../system.js";

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
  crm: typeof crm;
  crmBlueprint: typeof crmBlueprint;
  crmDemo: typeof crmDemo;
  crons: typeof crons;
  documents: typeof documents;
  finance: typeof finance;
  ingest: typeof ingest;
  invoicing: typeof invoicing;
  mail: typeof mail;
  mcp: typeof mcp;
  notifications: typeof notifications;
  roleAdmin: typeof roleAdmin;
  search: typeof search;
  staffing: typeof staffing;
  system: typeof system;
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
