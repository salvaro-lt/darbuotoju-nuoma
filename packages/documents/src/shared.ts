// Internals shared by the archive and signing functions: loosely typed table
// access (the app's schema contains `documentsTables`), errors, validation.
import { v, type GenericId } from "convex/values"
import { SystemError, toConvexError, type Actor } from "@digimuza/system-core/convex"
import type { MatchAlgorithm } from "./matching"
import type { PageSize, SigningField, SigningValue, SubmissionStatus, SubmitterStatus } from "./signing"
import type { CustomFieldType } from "./tables"

export type DocumentId = GenericId<"docDocuments">
export type TagId = GenericId<"docTags">
export type CorrespondentId = GenericId<"docCorrespondents">
export type DocTypeId = GenericId<"docTypes">
export type CustomFieldId = GenericId<"docCustomFields">
export type SavedViewId = GenericId<"docSavedViews">
export type NoteId = GenericId<"docNotes">
export type TemplateId = GenericId<"docTemplates">
export type SubmissionId = GenericId<"docSubmissions">
export type SubmitterId = GenericId<"docSubmitters">
export type StorageId = GenericId<"_storage">

interface Rule {
  match: string
  algorithm: MatchAlgorithm
  caseSensitive: boolean
}
export interface TagDoc extends Rule {
  _id: TagId
  _creationTime: number
  name: string
  color: string
  isInbox: boolean
}
export interface CorrespondentDoc extends Rule {
  _id: CorrespondentId
  _creationTime: number
  name: string
}
export interface TypeDoc extends Rule {
  _id: DocTypeId
  _creationTime: number
  name: string
}
export interface CustomFieldDoc {
  _id: CustomFieldId
  _creationTime: number
  name: string
  type: CustomFieldType
  options: string[]
  position: number
}
export interface DocumentDoc {
  _id: DocumentId
  _creationTime: number
  title: string
  storageId: StorageId
  thumbnailId?: StorageId
  ocrImageIds: StorageId[]
  fileName: string
  mimeType: string
  size: number
  sha256: string
  pageCount?: number
  content: string
  contentSource: "pdf" | "ai" | "manual" | "none"
  processing: "queued" | "done" | "failed"
  processingError?: string
  documentDate?: string
  correspondentId?: CorrespondentId
  typeId?: DocTypeId
  tagIds: TagId[]
  custom: Record<string, unknown>
  asn: number
  searchText: string
  trashed: boolean
  submissionId?: SubmissionId
  addedBy: string
  updatedAt: number
}
export interface NoteDoc {
  _id: NoteId
  _creationTime: number
  documentId: DocumentId
  body: string
  createdBy: string
  authorName: string
}
export interface ViewFilters {
  search?: string
  tagIds?: string[]
  tagMode?: "all" | "any"
  withoutTags?: boolean
  correspondentId?: string
  typeId?: string
  from?: string
  to?: string
}
export interface SavedViewDoc {
  _id: SavedViewId
  _creationTime: number
  name: string
  filters: ViewFilters
  showInSidebar: boolean
  position: number
}
export interface TemplateDoc {
  _id: TemplateId
  _creationTime: number
  name: string
  storageId: StorageId
  fileName: string
  sha256: string
  pages: PageSize[]
  roles: string[]
  fields: SigningField[]
  documentId?: DocumentId
  archived: boolean
  createdBy: string
  updatedAt: number
}
export interface SubmissionDoc {
  _id: SubmissionId
  _creationTime: number
  templateId: TemplateId
  name: string
  storageId: StorageId
  sha256: string
  roles: string[]
  fields: SigningField[]
  status: SubmissionStatus
  ordered: boolean
  message?: string
  expiresAt?: number
  locale: "lt" | "en"
  signedStorageId?: StorageId
  signedSha256?: string
  documentId?: DocumentId
  finalizeError?: string
  createdBy: string
  createdByName: string
  completedAt?: number
}
export interface SubmitterDoc {
  _id: SubmitterId
  _creationTime: number
  submissionId: SubmissionId
  role: number
  name: string
  email: string
  tokenHash: string
  downloadTokenHash?: string
  status: SubmitterStatus
  values: Record<string, SigningValue>
  sentAt?: number
  openedAt?: number
  completedAt?: number
  userAgent?: string
  declineReason?: string
}
export type SigningEventKind = "created" | "sent" | "send_failed" | "opened" | "completed" | "declined" | "cancelled" | "finalized" | "finalize_failed"
export interface SigningEventDoc {
  _id: GenericId<"docSigningEvents">
  _creationTime: number
  submissionId: SubmissionId
  submitterId?: SubmitterId
  kind: SigningEventKind
  at: number
  detail?: string
}
export interface CounterDoc {
  _id: GenericId<"docCounters">
  key: string
  value: number
}

type Docs = {
  docTags: TagDoc
  docCorrespondents: CorrespondentDoc
  docTypes: TypeDoc
  docCustomFields: CustomFieldDoc
  docDocuments: DocumentDoc
  docNotes: NoteDoc
  docSavedViews: SavedViewDoc
  docTemplates: TemplateDoc
  docSubmissions: SubmissionDoc
  docSubmitters: SubmitterDoc
  docSigningEvents: SigningEventDoc
  docCounters: CounterDoc
}
export type Table = keyof Docs

interface Range {
  eq(field: string, value: unknown): Range
}
interface Q<D> {
  withIndex(name: string, range?: (q: Range) => Range): Q<D>
  withSearchIndex(name: string, search: (q: { search(field: string, text: string): Range }) => unknown): Q<D>
  order(o: "asc" | "desc"): Q<D>
  take(n: number): Promise<D[]>
  collect(): Promise<D[]>
  first(): Promise<D | null>
  unique(): Promise<D | null>
}
export interface Db {
  query<T extends Table>(t: T): Q<Docs[T]>
  get<T extends Table>(t: T, id: string): Promise<Docs[T] | null>
  insert<T extends Table>(t: T, doc: Omit<Docs[T], "_id" | "_creationTime">): Promise<Docs[T]["_id"]>
  patch<T extends Table>(t: T, id: string, doc: Partial<Omit<Docs[T], "_id" | "_creationTime">>): Promise<void>
  delete(t: Table, id: string): Promise<void>
  system: { get(t: "_storage", id: string): Promise<{ _id: StorageId; sha256: string; size: number; contentType?: string } | null> }
}
export const dbOf = (ctx: { db: unknown }) => ctx.db as Db

/** `db.get` that tolerates IDs of another table (returns null). */
export async function getDoc<T extends Table>(db: Db, table: T, id: string | undefined | null): Promise<Docs[T] | null> {
  if (!id) return null
  return db.get(table, id).catch(() => null)
}

export type Code = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "FORBIDDEN" | "UNAVAILABLE"
export function fail(code: Code, reason: string, operationId: string, fields?: string[]): never {
  throw toConvexError(new SystemError(code, undefined, { reason, operationId, ...(fields ? { fields } : {}) }), operationId)
}

export const actorId = (a: Actor) => (a.kind === "user" ? a.userId : a.apiKeyId)
export const actorArgs = { apiKey: v.optional(v.string()), operationId: v.optional(v.string()) }
export const opts = (a: { apiKey?: string | undefined; operationId?: string | undefined }) => ({ apiKey: a.apiKey, operationId: a.operationId })

export async function displayName(sys: { store: { get(t: "users" | "apiKeys", k: string): Promise<unknown> } }, actor: Actor): Promise<string> {
  if (actor.kind === "agent") {
    const key = (await sys.store.get("apiKeys", actor.apiKeyId)) as { name?: string } | null
    return key?.name ? `API: ${key.name}` : "API"
  }
  const user = (await sys.store.get("users", actor.userId)) as { displayName?: string; email?: string } | null
  return user?.displayName || user?.email || "?"
}

export function cleanText(value: string | undefined, max: number, field: string, operationId: string, required = true): string | undefined {
  const s = value?.trim() ?? ""
  if (!s) {
    if (required) fail("VALIDATION", `missing_${field}`, operationId, [field])
    return undefined
  }
  if (s.length > max) fail("VALIDATION", `too_long_${field}`, operationId, [field])
  return s
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/
export const isDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
export const COLOR = /^#[0-9a-fA-F]{6}$/
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Convex storage reports SHA-256 as base64; the module stores hex. */
export function base64ToHex(b64: string): string {
  const bin = atob(b64)
  let out = ""
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0")
  return out
}

export async function sha256OfBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
