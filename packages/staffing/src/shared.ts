// Internals shared by the staffing functions and by every staffing area:
// typed table access, typed IDs, errors and input cleaning.
import type { DataModelFromSchemaDefinition, DocumentByName, GenericDatabaseReader, GenericDatabaseWriter, GenericSchema, SchemaDefinition } from "convex/server"
import { v, type GenericId } from "convex/values"
import { SystemError, toConvexError, type Actor } from "@digimuza/system-core/convex"
import { fold, isIsoDate } from "./pure"
import type { staffingTables } from "./tables"

/** The data model of any table set (`DataModelOf<typeof staffingTables & typeof myAreaTables>`). */
export type DataModelOf<Tables extends GenericSchema> = DataModelFromSchemaDefinition<SchemaDefinition<Tables, true>>
export type StaffingDataModel = DataModelOf<typeof staffingTables>
export type StaffingTable = keyof typeof staffingTables
/** A stored row of a staffing table, with `_id` and `_creationTime`. */
export type StaffingDoc<T extends StaffingTable> = DocumentByName<StaffingDataModel, T>

export type TradeId = GenericId<"staffing_trades">
export type CertificateTypeId = GenericId<"staffing_certificateTypes">
export type WorkerId = GenericId<"staffing_workers">
export type WorkerCertificateId = GenericId<"staffing_workerCertificates">
export type ClientId = GenericId<"staffing_clients">
export type ProjectId = GenericId<"staffing_projects">
export type AssignmentId = GenericId<"staffing_assignments">
export type StorageId = GenericId<"_storage">

export type TradeDoc = StaffingDoc<"staffing_trades">
export type CertificateTypeDoc = StaffingDoc<"staffing_certificateTypes">
export type WorkerDoc = StaffingDoc<"staffing_workers">
export type WorkerCertificateDoc = StaffingDoc<"staffing_workerCertificates">
export type ClientDoc = StaffingDoc<"staffing_clients">
export type ProjectDoc = StaffingDoc<"staffing_projects">
export type AssignmentDoc = StaffingDoc<"staffing_assignments">
export type AvailabilityId = GenericId<"staffing_workerAvailability">
export type AvailabilityDoc = StaffingDoc<"staffing_workerAvailability">

/**
 * Any Convex ctx with a database (query, mutation, or the AI tool context).
 * The app's generated ctx types aren't assignable to the module's data model,
 * so operations take `{ db: unknown }` and view it through `readerOf` / `writerOf`.
 */
export interface DbCtxLike {
  db: unknown
}
export const readerOf = <DM extends StaffingDataModel = StaffingDataModel>(ctx: DbCtxLike) => ctx.db as GenericDatabaseReader<DM>
export const writerOf = <DM extends StaffingDataModel = StaffingDataModel>(ctx: DbCtxLike) => ctx.db as GenericDatabaseWriter<DM>

// ---------------------------------------------------------------- errors

export type Code = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "FORBIDDEN" | "UNAVAILABLE"

/** Throws a system error with a stable code and a machine-readable reason. */
export function fail(code: Code, reason: string, operationId: string, fields?: string[]): never {
  throw toConvexError(new SystemError(code, undefined, { reason, operationId, ...(fields ? { fields } : {}) }), operationId)
}

export const actorId = (a: Actor) => (a.kind === "user" ? a.userId : a.apiKeyId)
/** `apiKey` lets agents act with their own roles; `operationId` threads a caller's trace. */
export const actorArgs = { apiKey: v.optional(v.string()), operationId: v.optional(v.string()) }
export const opts = (a: { apiKey?: string | undefined; operationId?: string | undefined }) => ({ apiKey: a.apiKey, operationId: a.operationId })

// ---------------------------------------------------------------- input cleaning

/** Trimmed text within `max`; `undefined` when empty and optional. */
export function cleanText(value: string | undefined, max: number, field: string, operationId: string, required = true): string | undefined {
  const s = value?.trim() ?? ""
  if (!s) {
    if (required) fail("VALIDATION", `missing_${field}`, operationId, [field])
    return undefined
  }
  if (s.length > max) fail("VALIDATION", `too_long_${field}`, operationId, [field])
  return s
}

export function cleanDate(value: string | undefined | null, field: string, operationId: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (!isIsoDate(value)) fail("VALIDATION", `invalid_${field}`, operationId, [field])
  return value
}

/** `start <= end` when both are set. */
export function checkRange(start: string, end: string | undefined, operationId: string, field = "endDate") {
  if (end && end < start) fail("VALIDATION", "end_before_start", operationId, [field])
}

export const COUNTRY = /^[A-Z]{2}$/
export const LANGUAGE = /^[a-z]{2}$/
export const CODE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function cleanCountry(value: string, field: string, operationId: string): string {
  const s = value.trim().toUpperCase()
  if (!COUNTRY.test(s)) fail("VALIDATION", `invalid_${field}`, operationId, [field])
  return s
}

export function cleanCode(value: string, field: string, operationId: string): string {
  const s = value.trim().toUpperCase()
  if (!CODE.test(s)) fail("VALIDATION", `invalid_${field}`, operationId, [field])
  return s
}

export function cleanCents(value: number, field: string, operationId: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000_00) fail("VALIDATION", `invalid_${field}`, operationId, [field])
  return value
}

/** Search text of a worker: folded name, phone, email, city and notes start. */
export function workerSearchText(w: Pick<WorkerDoc, "firstName" | "lastName" | "phone" | "email" | "homeCity" | "homeCountry" | "nationality">): string {
  return fold([w.firstName, w.lastName, w.phone.replace(/\s+/g, ""), w.email ?? "", w.homeCity, w.homeCountry, w.nationality].join(" "))
}
