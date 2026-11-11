// The archive half: documents and their labels (tags, correspondents,
// document types, custom fields), matching rules, saved views, notes, and
// the background processing (text recognition, `auto` labels).
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { decide, isFeatureEnabled, recordAudit, type ConvexSystem, type SystemContext } from "@digimuza/system-core/convex"
import { canSeeDocument, canSeeTag, isShared, mergeTagIds, restrictedTagsOf, viewerFor, visibleTagIds, type Viewer } from "./access"
import { classifyDocument, recognizeText, type AiConfig } from "./ai"
import { DocumentsFlags, DocumentsPermissions } from "./manifest"
import { matches, matchingIds, ruleProblem, type MatchAlgorithm, type MatchRule } from "./matching"
import {
  actorArgs,
  actorId,
  base64ToHex,
  bytesToBase64,
  cleanText,
  COLOR,
  dbOf,
  displayName,
  fail,
  getDoc,
  isDate,
  opts,
  type CorrespondentDoc,
  type CustomFieldDoc,
  type CustomFieldId,
  type Db,
  type DocTypeId,
  type DocumentDoc,
  type DocumentId,
  type NoteId,
  type SavedViewId,
  type StorageId,
  type TagDoc,
  type TagId,
  type TypeDoc,
  type ViewFilters,
} from "./shared"
import { customFieldTypeValidator, matchAlgorithmValidator, tagAccessValidator, viewFilterValidator, type CustomFieldType } from "./tables"

// ---------------------------------------------------------------- public shapes

export type LabelKind = "tag" | "correspondent" | "type"

export interface LabelView extends MatchRule {
  id: string
  name: string
  /** Documents (not in the trash) with this label, among the newest `scanLimit`. */
  count: number
}
export interface TagView extends LabelView {
  color: string
  isInbox: boolean
  /** null: everyone with read access sees it. Otherwise restricted to these users and roles. */
  access: { userIds: string[]; roleIds: string[] } | null
}
export interface CustomFieldView {
  id: CustomFieldId
  name: string
  type: CustomFieldType
  options: string[]
}
export interface SavedViewView {
  id: SavedViewId
  name: string
  filters: ViewFilters
  showInSidebar: boolean
}
export interface DocumentsLabels {
  tags: TagView[]
  correspondents: LabelView[]
  types: LabelView[]
  customFields: CustomFieldView[]
  views: SavedViewView[]
}

export interface DocumentView {
  id: DocumentId
  asn: number
  title: string
  fileName: string
  mimeType: string
  size: number
  pageCount: number | null
  documentDate: string | null
  correspondentId: string | null
  typeId: string | null
  tagIds: string[]
  custom: Record<string, unknown>
  addedAt: number
  updatedAt: number
  processing: "queued" | "done" | "failed"
  contentSource: "pdf" | "ai" | "manual" | "none"
  thumbnailUrl: string | null
  trashed: boolean
  fromSigning: boolean
  /** Filed from a received email (the email itself or one of its attachments). */
  fromEmail: boolean
  /** The email document an attachment came with. */
  parentId: string | null
  /** Not visible to every reader: it carries a restricted label or is shared. */
  restricted: boolean
  /** A short excerpt of the text, for result lists. */
  excerpt: string
}
export interface DocumentNoteView {
  id: NoteId
  body: string
  authorName: string
  mine: boolean
  createdAt: number
}
export interface DocumentDetail {
  document: DocumentView
  content: string
  sha256: string
  fileUrl: string | null
  processingError: string | null
  notes: DocumentNoteView[]
  submissionId: string | null
  /** Who can see it, as far as this viewer may know. */
  access: {
    sharedUserIds: string[]
    sharedRoleIds: string[]
    /** Restricted labels on it that this viewer can see. */
    restrictedTagIds: string[]
  }
  /** Attachments filed with this email. */
  attachments: { id: DocumentId; title: string; fileName: string; mimeType: string; size: number }[]
}
export interface AccessOptions {
  roles: { id: string; name: string }[]
  users: { id: string; name: string; email: string }[]
}
export interface DocumentListResult {
  documents: DocumentView[]
  total: number
  truncated: boolean
}

export interface ArchiveOptions {
  /** Rows a list query reads before filtering (newest first). Default 2000, max 8000. */
  scanLimit?: number
  /** Largest upload in bytes. Default 50 MB. */
  maxFileSize?: number
  /** AI model for text recognition and `auto` labels. Default DOCUMENTS_AI_MODEL, then AI_MODEL, then this. */
  aiModel?: string
  /** Tests inject a fake model API. */
  aiFetch?: typeof globalThis.fetch
}

// ---------------------------------------------------------------- helpers

const MAX_TITLE = 200
const MAX_NAME = 120
const MAX_MATCH = 500
const MAX_CONTENT = 300_000
const MAX_SEARCH_TEXT = 30_000
const MAX_NOTE = 20_000
const MAX_TAGS = 100
const MAX_BULK = 200
const MAX_GRANTS = 100
const OCR_MIN_CHARS = 30
const OCR_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const rule = { match: v.string(), algorithm: matchAlgorithmValidator, caseSensitive: v.boolean() }

/** The label every archived email carries; created restricted (only `documents:document:all`). */
export const EMAIL_TAG = "El. laiškas"
/** `addedBy` of documents filed from received mail. */
export const EMAIL_UPLOADER = "system:email"

const safeFileName = (s: string) =>
  [...s]
    .map((c) => (c.charCodeAt(0) < 32 ? " " : c))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "laiskas"

const titleFromFile = (fileName: string) =>
  fileName
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[_]+/g, " ")
    .trim()
    .slice(0, MAX_TITLE) || "Dokumentas"

const excerpt = (content: string) => content.replace(/\s+/g, " ").trim().slice(0, 220)

const labelTable = { tag: "docTags", correspondent: "docCorrespondents", type: "docTypes" } as const

interface Taxonomy {
  tags: TagDoc[]
  correspondents: CorrespondentDoc[]
  types: TypeDoc[]
}

async function taxonomy(db: Db): Promise<Taxonomy> {
  const [tags, correspondents, types] = await Promise.all([db.query("docTags").collect(), db.query("docCorrespondents").collect(), db.query("docTypes").collect()])
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
  return { tags: tags.sort(byName), correspondents: correspondents.sort(byName), types: types.sort(byName) }
}

function searchTextOf(d: Pick<DocumentDoc, "title" | "fileName" | "content" | "tagIds" | "correspondentId" | "typeId" | "asn" | "custom">, tx: Taxonomy): string {
  const names = (ids: string[], from: { _id: string; name: string }[]) => ids.map((id) => from.find((x) => x._id === id)?.name).filter(Boolean)
  const custom = Object.values(d.custom).filter((x) => typeof x === "string" || typeof x === "number")
  return [
    d.title,
    d.fileName,
    `#${d.asn}`,
    // Restricted labels stay out of the search text: their names must not be probed by search.
    ...names(d.tagIds, tx.tags.filter((t) => !t.access)),
    ...names(d.correspondentId ? [d.correspondentId] : [], tx.correspondents),
    ...names(d.typeId ? [d.typeId] : [], tx.types),
    ...custom,
    d.content,
  ]
    .join(" ")
    .slice(0, MAX_SEARCH_TEXT)
}

/** Labels the matching rules select: tags are added, correspondent and type fill only when empty. */
function applyRules(tx: Taxonomy, content: string, current: { tagIds: TagId[]; correspondentId?: string | undefined; typeId?: string | undefined }) {
  const tagIds = [...new Set([...current.tagIds, ...(matchingIds(tx.tags.map((t) => ({ ...t, id: t._id })), content) as TagId[])])]
  const correspondentId = current.correspondentId ?? tx.correspondents.find((c) => matches(c, content))?._id
  const typeId = current.typeId ?? tx.types.find((t) => matches(t, content))?._id
  return { tagIds, correspondentId, typeId }
}

const hasAuto = (tx: Taxonomy) => [...tx.tags, ...tx.correspondents, ...tx.types].some((l) => l.algorithm === "auto")

function cleanRule(a: { match: string; algorithm: MatchAlgorithm; caseSensitive: boolean }, op: string): MatchRule {
  const r = { match: a.match.trim(), algorithm: a.algorithm, caseSensitive: a.caseSensitive }
  if (r.match.length > MAX_MATCH) fail("VALIDATION", "too_long_match", op, ["match"])
  const p = ruleProblem(r)
  if (p) fail("VALIDATION", p, op, ["match"])
  return r
}

function cleanFilters(f: ViewFilters, op: string): ViewFilters {
  const out: ViewFilters = {}
  const search = f.search?.trim()
  if (search) out.search = search.slice(0, 200)
  if (f.tagIds?.length) {
    if (f.tagIds.length > 20) fail("VALIDATION", "too_many_tags", op, ["tagIds"])
    out.tagIds = [...new Set(f.tagIds)]
  }
  if (f.tagMode) out.tagMode = f.tagMode
  if (f.withoutTags) out.withoutTags = true
  if (f.correspondentId) out.correspondentId = f.correspondentId
  if (f.typeId) out.typeId = f.typeId
  for (const k of ["from", "to"] as const) {
    const d = f[k]
    if (d) {
      if (!isDate(d)) fail("VALIDATION", "invalid_date", op, [k])
      out[k] = d
    }
  }
  return out
}

function customProblems(fields: CustomFieldDoc[], values: Record<string, unknown>): string[] {
  const bad: string[] = []
  for (const [k, val] of Object.entries(values)) {
    const f = fields.find((x) => x._id === k)
    if (!f) {
      bad.push(k)
      continue
    }
    if (val === null) continue
    const ok =
      f.type === "text" || f.type === "url"
        ? typeof val === "string" && val.length <= 2000 && (f.type !== "url" || /^https?:\/\/\S+$/.test(val))
        : f.type === "number" || f.type === "monetary"
          ? typeof val === "number" && Number.isFinite(val)
          : f.type === "date"
            ? typeof val === "string" && isDate(val)
            : f.type === "boolean"
              ? typeof val === "boolean"
              : typeof val === "string" && f.options.includes(val)
    if (!ok) bad.push(k)
  }
  return bad
}

async function nextAsn(db: Db): Promise<number> {
  const row = await db
    .query("docCounters")
    .withIndex("by_key", (q) => q.eq("key", "asn"))
    .unique()
  const value = (row?.value ?? 0) + 1
  if (row) await db.patch("docCounters", row._id, { value })
  else await db.insert("docCounters", { key: "asn", value })
  return value
}

async function ensureTag(db: Db, name: string, extra: Partial<TagDoc>, color: string): Promise<TagId> {
  const found = await db
    .query("docTags")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first()
  return found?._id ?? (await db.insert("docTags", { name, color, isInbox: false, match: "", algorithm: "none", caseSensitive: false, ...extra }))
}

/**
 * The label every archived email carries, found by its `system` marker (never by name,
 * so a public label someone named "El. laiškas" is not taken over). Created restricted.
 */
export async function emailTag(db: Db): Promise<TagId> {
  const tags = await db.query("docTags").collect()
  const found = tags.find((t) => t.system === "email")
  if (found) return found._id
  const name = tags.some((t) => t.name === EMAIL_TAG) ? `${EMAIL_TAG} (archyvas)` : EMAIL_TAG
  return db.insert("docTags", { name, color: "#64748b", isInbox: false, match: "", algorithm: "none", caseSensitive: false, system: "email", access: { userIds: [], roleIds: [] } })
}

/** Adds labels to a filed email and its attachments. */
async function addEmailTags(db: Db, email: DocumentDoc, tagIds: TagId[]) {
  const tx = await taxonomy(db)
  const family = [
    email,
    ...(await db
      .query("docDocuments")
      .withIndex("by_parent", (q) => q.eq("parentId", email._id))
      .collect()),
  ]
  for (const d of family) {
    const next = [...new Set([...d.tagIds, ...tagIds])]
    if (next.length !== d.tagIds.length) await db.patch("docDocuments", d._id, { tagIds: next, searchText: searchTextOf({ ...d, tagIds: next }, tx), updatedAt: Date.now() })
  }
}

// ---------------------------------------------------------------- the functions

export function defineArchive(system: ConvexSystem, options: ArchiveOptions & { functionsModule: string }) {
  const scanLimit = Math.min(Math.max(options.scanLimit ?? 2000, 100), 8000)
  const maxFileSize = options.maxFileSize ?? 50 * 1024 * 1024
  const ref = (name: string) => makeFunctionReference<"query" | "mutation" | "action">(`${options.functionsModule}:${name}`)
  const aiConfig = (): AiConfig => ({
    model: process.env.DOCUMENTS_AI_MODEL || process.env.AI_MODEL || options.aiModel || "gpt-4o-mini",
    fetch: options.aiFetch,
  })

  type Ctx = { storage: { getUrl(id: string): Promise<string | null> } }
  type TagMap = ReadonlyMap<string, TagDoc>
  const tagMapOf = (tx: Taxonomy): TagMap => new Map(tx.tags.map((t) => [t._id as string, t]))
  async function documentView(ctx: Ctx, d: DocumentDoc, viewer: Viewer, tags: TagMap): Promise<DocumentView> {
    return {
      id: d._id,
      asn: d.asn,
      title: d.title,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      pageCount: d.pageCount ?? null,
      documentDate: d.documentDate ?? null,
      correspondentId: d.correspondentId ?? null,
      typeId: d.typeId ?? null,
      tagIds: visibleTagIds(viewer, d.tagIds, tags),
      custom: d.custom,
      addedAt: d._creationTime,
      updatedAt: d.updatedAt,
      processing: d.processing,
      contentSource: d.contentSource,
      thumbnailUrl: d.thumbnailId ? await ctx.storage.getUrl(d.thumbnailId) : null,
      trashed: d.trashed,
      fromSigning: Boolean(d.submissionId),
      fromEmail: Boolean(d.emailKey),
      parentId: d.parentId ?? null,
      restricted: isShared(d) || restrictedTagsOf(d, tags).length > 0,
      excerpt: excerpt(d.content),
    }
  }

  /** The document, if it exists and the viewer may see it (hidden documents are "not found"). */
  async function requireDocument(db: Db, id: string, op: string, viewer: Viewer, tags: TagMap): Promise<DocumentDoc> {
    const d = await getDoc(db, "docDocuments", id)
    if (!d || !canSeeDocument(viewer, d, tags)) fail("NOT_FOUND", "document_not_found", op)
    return d
  }

  /** The caller's permission check plus who they are for document access. */
  async function guard(ctx: Parameters<ConvexSystem["requirePermission"]>[0], permission: string, a: { apiKey?: string | undefined; operationId?: string | undefined }) {
    const r = await system.requirePermission(ctx, permission, opts(a))
    return { ...r, viewer: await viewerFor(r.sys, r.actor) }
  }

  /** Users and roles to grant: they must exist (roles not archived). */
  async function checkGrants(sys: SystemContext, op: string, access: { userIds: string[]; roleIds: string[] }) {
    const clean = { userIds: [...new Set(access.userIds)], roleIds: [...new Set(access.roleIds)] }
    if (clean.userIds.length > MAX_GRANTS || clean.roleIds.length > MAX_GRANTS) fail("VALIDATION", "too_many_grants", op, ["access"])
    for (const id of clean.userIds) if (!(await sys.store.get("users", id))) fail("VALIDATION", "invalid_user", op, ["userIds"])
    for (const id of clean.roleIds) {
      const role = await sys.store.get("roles", id)
      if (!role || role.archived) fail("VALIDATION", "invalid_role", op, ["roleIds"])
    }
    return clean
  }

  async function checkLabels(db: Db, op: string, a: { tagIds?: string[] | undefined; correspondentId?: string | null | undefined; typeId?: string | null | undefined }, viewer: Viewer) {
    if (a.tagIds) {
      if (a.tagIds.length > MAX_TAGS) fail("VALIDATION", "too_many_tags", op, ["tagIds"])
      for (const id of a.tagIds) {
        const tag = await getDoc(db, "docTags", id)
        if (!tag || !canSeeTag(viewer, tag)) fail("VALIDATION", "invalid_tag", op, ["tagIds"])
      }
    }
    if (a.correspondentId && !(await getDoc(db, "docCorrespondents", a.correspondentId))) fail("VALIDATION", "invalid_correspondent", op, ["correspondentId"])
    if (a.typeId && !(await getDoc(db, "docTypes", a.typeId))) fail("VALIDATION", "invalid_type", op, ["typeId"])
  }

  /** Documents after filters and sort. */
  async function queryDocuments(db: Db, f: ViewFilters & { trashed?: boolean | undefined }, viewer: Viewer, tags: TagMap) {
    const trashed = f.trashed ?? false
    const search = f.search?.trim()
    const limit = search ? Math.min(scanLimit, 1024) : scanLimit
    const rows = search
      ? await db
          .query("docDocuments")
          .withSearchIndex("search", (q) => {
            let r = q.search("searchText", search).eq("trashed", trashed)
            if (f.correspondentId) r = r.eq("correspondentId", f.correspondentId)
            if (f.typeId) r = r.eq("typeId", f.typeId)
            return r
          })
          .take(limit)
      : f.correspondentId
        ? await db
            .query("docDocuments")
            .withIndex("by_correspondent", (q) => q.eq("correspondentId", f.correspondentId).eq("trashed", trashed))
            .order("desc")
            .take(limit)
        : f.typeId
          ? await db
              .query("docDocuments")
              .withIndex("by_type", (q) => q.eq("typeId", f.typeId).eq("trashed", trashed))
              .order("desc")
              .take(limit)
          : await db
              .query("docDocuments")
              .withIndex("by_trashed", (q) => q.eq("trashed", trashed))
              .order("desc")
              .take(limit)
    let out = rows.filter((d) => canSeeDocument(viewer, d, tags))
    if (f.correspondentId) out = out.filter((d) => d.correspondentId === f.correspondentId)
    if (f.typeId) out = out.filter((d) => d.typeId === f.typeId)
    if (f.withoutTags) out = out.filter((d) => visibleTagIds(viewer, d.tagIds, tags).length === 0)
    if (f.tagIds?.length) {
      // A label the viewer cannot see matches nothing ("all") or is ignored ("any").
      const hidden = f.tagIds.filter((id) => {
        const t = tags.get(id)
        return t && !canSeeTag(viewer, t)
      })
      if (hidden.length && f.tagMode !== "any") return { rows: [], truncated: false }
      const want = f.tagIds.filter((id) => !hidden.includes(id))
      if (!want.length) return { rows: [], truncated: false }
      out = out.filter((d) => (f.tagMode === "any" ? want.some((t) => d.tagIds.includes(t as TagId)) : want.every((t) => d.tagIds.includes(t as TagId))))
    }
    if (f.from) out = out.filter((d) => (d.documentDate ?? "") >= f.from!)
    if (f.to) out = out.filter((d) => d.documentDate !== undefined && d.documentDate <= f.to!)
    return { rows: out, truncated: rows.length >= limit }
  }

  /** Rebuilds the search text of documents that carry a renamed or deleted label. */
  async function reindex(db: Db, pick: (d: DocumentDoc) => boolean, change: (d: DocumentDoc) => Partial<DocumentDoc> = () => ({})) {
    const tx = await taxonomy(db)
    for (const trashed of [false, true]) {
      const rows = await db
        .query("docDocuments")
        .withIndex("by_trashed", (q) => q.eq("trashed", trashed))
        .take(scanLimit)
      for (const d of rows.filter(pick)) {
        const next = { ...d, ...change(d) }
        await db.patch("docDocuments", d._id, { ...change(d), searchText: searchTextOf(next, tx) })
      }
    }
  }

  const sortKeys = v.union(v.literal("added"), v.literal("date"), v.literal("title"), v.literal("asn"), v.literal("relevance"))

  return {
    // ------------------------------------------------------------ labels

    /** Tags, correspondents, types, custom fields and saved views, with document counts. */
    getLabels: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<DocumentsLabels> => {
        const { viewer } = await guard(ctx, DocumentsPermissions.read, a)
        const db = dbOf(ctx)
        const tx = await taxonomy(db)
        const tags = tagMapOf(tx)
        const docs = (
          await db
            .query("docDocuments")
            .withIndex("by_trashed", (q) => q.eq("trashed", false))
            .take(scanLimit)
        ).filter((d) => canSeeDocument(viewer, d, tags))
        const counts = new Map<string, number>()
        for (const d of docs) for (const id of [...d.tagIds, d.correspondentId, d.typeId]) if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
        const base = (l: TagDoc | CorrespondentDoc | TypeDoc): LabelView => ({ id: l._id, name: l.name, match: l.match, algorithm: l.algorithm, caseSensitive: l.caseSensitive, count: counts.get(l._id) ?? 0 })
        const fields = (await db.query("docCustomFields").collect()).sort((x, y) => x.position - y.position)
        const views = await db.query("docSavedViews").withIndex("by_position").collect()
        return {
          tags: tx.tags.filter((t) => canSeeTag(viewer, t)).map((t) => ({ ...base(t), color: t.color, isInbox: t.isInbox, access: t.access ?? null })),
          correspondents: tx.correspondents.map(base),
          types: tx.types.map(base),
          customFields: fields.map((f) => ({ id: f._id, name: f.name, type: f.type, options: f.options })),
          views: views.map((w) => ({ id: w._id, name: w.name, filters: w.filters, showInSidebar: w.showInSidebar })),
        }
      },
    }),

    createLabel: mutationGeneric({
      args: {
        ...actorArgs,
        kind: v.union(v.literal("tag"), v.literal("correspondent"), v.literal("type")),
        name: v.string(),
        color: v.optional(v.string()),
        isInbox: v.optional(v.boolean()),
        /** Tags only: restrict who sees it (absent or null: everyone). */
        access: v.optional(v.union(v.null(), tagAccessValidator)),
        ...rule,
      },
      handler: async (ctx, a): Promise<{ id: string; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const name = cleanText(a.name, MAX_NAME, "name", op)!
        const r = cleanRule(a, op)
        const table = labelTable[a.kind]
        const dup = await db
          .query(table)
          .withIndex("by_name", (q) => q.eq("name", name))
          .first()
        if (dup) fail("CONFLICT", "duplicate_name", op, ["name"])
        let id: string
        if (a.kind === "tag") {
          const color = a.color ?? "#64748b"
          if (!COLOR.test(color)) fail("VALIDATION", "invalid_color", op, ["color"])
          const access = a.access ? await checkGrants(sys, op, a.access) : undefined
          id = await db.insert("docTags", { name, color, isInbox: a.isInbox ?? false, ...(access ? { access } : {}), ...r })
        } else id = await db.insert(table as "docTypes", { name, ...r })
        await recordAudit(sys, actor, { action: `documents.${a.kind}.create`, targetType: table, targetId: id, changes: { name, algorithm: r.algorithm, restricted: Boolean(a.access) } })
        return { id, operationId: op }
      },
    }),

    updateLabel: mutationGeneric({
      args: {
        ...actorArgs,
        kind: v.union(v.literal("tag"), v.literal("correspondent"), v.literal("type")),
        id: v.string(),
        name: v.optional(v.string()),
        color: v.optional(v.string()),
        isInbox: v.optional(v.boolean()),
        match: v.optional(v.string()),
        algorithm: v.optional(matchAlgorithmValidator),
        caseSensitive: v.optional(v.boolean()),
        /** Tags only: null makes it public again. */
        access: v.optional(v.union(v.null(), tagAccessValidator)),
      },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.manageLabels, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const table = labelTable[a.kind]
        const label = await getDoc(db, table, a.id)
        if (!label || (a.kind === "tag" && !canSeeTag(viewer, label as TagDoc))) fail("NOT_FOUND", "label_not_found", op)
        const patch: Record<string, unknown> = {}
        if (a.name !== undefined) {
          const name = cleanText(a.name, MAX_NAME, "name", op)!
          const dup = await db
            .query(table)
            .withIndex("by_name", (q) => q.eq("name", name))
            .first()
          if (dup && dup._id !== label._id) fail("CONFLICT", "duplicate_name", op, ["name"])
          patch.name = name
        }
        if (a.match !== undefined || a.algorithm !== undefined || a.caseSensitive !== undefined) {
          Object.assign(patch, cleanRule({ match: a.match ?? label.match, algorithm: a.algorithm ?? label.algorithm, caseSensitive: a.caseSensitive ?? label.caseSensitive }, op))
        }
        if (a.kind === "tag") {
          if (a.color !== undefined) {
            if (!COLOR.test(a.color)) fail("VALIDATION", "invalid_color", op, ["color"])
            patch.color = a.color
          }
          if (a.isInbox !== undefined) patch.isInbox = a.isInbox
          if (a.access !== undefined) patch.access = a.access === null ? undefined : await checkGrants(sys, op, a.access)
        }
        await db.patch(table, label._id, patch)
        // Names go into the search text; restricted labels' names do not.
        if (patch.name || "access" in patch) await reindex(db, (d) => d.tagIds.includes(label._id as TagId) || d.correspondentId === label._id || d.typeId === label._id)
        await recordAudit(sys, actor, {
          action: `documents.${a.kind}.update`,
          targetType: table,
          targetId: label._id,
          changes: { fields: Object.keys(patch), ...(patch.access !== undefined || a.access === null ? { access: patch.access ?? null } : {}) },
        })
        return { operationId: op }
      },
    }),

    /** Removes the label from every document that carries it. */
    deleteLabel: mutationGeneric({
      args: { ...actorArgs, kind: v.union(v.literal("tag"), v.literal("correspondent"), v.literal("type")), id: v.string() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.manageLabels, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const table = labelTable[a.kind]
        const label = await getDoc(db, table, a.id)
        if (!label || (a.kind === "tag" && !canSeeTag(viewer, label as TagDoc))) fail("NOT_FOUND", "label_not_found", op)
        await db.delete(table, label._id)
        const id = label._id as string
        await reindex(
          db,
          (d) => d.tagIds.includes(id as TagId) || d.correspondentId === id || d.typeId === id,
          (d) => ({
            tagIds: d.tagIds.filter((t) => t !== id),
            ...(d.correspondentId === id ? { correspondentId: undefined } : {}),
            ...(d.typeId === id ? { typeId: undefined } : {}),
          }),
        )
        await recordAudit(sys, actor, { action: `documents.${a.kind}.delete`, targetType: table, targetId: id, changes: { name: label.name } })
        return { operationId: op }
      },
    }),

    /** How many of the newest documents a rule would select: a preview for the rule editor. */
    testRule: queryGeneric({
      args: { ...actorArgs, ...rule },
      handler: async (ctx, a): Promise<{ matched: number; scanned: number; examples: { id: DocumentId; title: string }[]; problem: string | null }> => {
        const { viewer } = await guard(ctx, DocumentsPermissions.read, a)
        const r = { match: a.match, algorithm: a.algorithm, caseSensitive: a.caseSensitive }
        const problem = ruleProblem(r)
        if (problem) return { matched: 0, scanned: 0, examples: [], problem }
        const db = dbOf(ctx)
        const tags = tagMapOf(await taxonomy(db))
        const rows = (
          await db
            .query("docDocuments")
            .withIndex("by_trashed", (q) => q.eq("trashed", false))
            .order("desc")
            .take(500)
        ).filter((d) => canSeeDocument(viewer, d, tags))
        const hit = rows.filter((d) => matches(r, d.content))
        return { matched: hit.length, scanned: rows.length, examples: hit.slice(0, 5).map((d) => ({ id: d._id, title: d.title })), problem: null }
      },
    }),

    createCustomField: mutationGeneric({
      args: { ...actorArgs, name: v.string(), type: customFieldTypeValidator, options: v.optional(v.array(v.string())) },
      handler: async (ctx, a): Promise<{ id: CustomFieldId; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const name = cleanText(a.name, MAX_NAME, "name", op)!
        if (
          await db
            .query("docCustomFields")
            .withIndex("by_name", (q) => q.eq("name", name))
            .first()
        )
          fail("CONFLICT", "duplicate_name", op, ["name"])
        const options = [...new Set((a.options ?? []).map((o) => o.trim()).filter(Boolean))]
        if (a.type === "select" && (options.length === 0 || options.length > 100)) fail("VALIDATION", "invalid_options", op, ["options"])
        const all = await db.query("docCustomFields").collect()
        if (all.length >= 50) fail("CONFLICT", "too_many_fields", op)
        const id = await db.insert("docCustomFields", { name, type: a.type, options: a.type === "select" ? options : [], position: all.length })
        await recordAudit(sys, actor, { action: "documents.custom_field.create", targetType: "docCustomFields", targetId: id, changes: { name, type: a.type } })
        return { id, operationId: op }
      },
    }),

    updateCustomField: mutationGeneric({
      args: { ...actorArgs, id: v.id("docCustomFields"), name: v.optional(v.string()), options: v.optional(v.array(v.string())) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const field = await getDoc(db, "docCustomFields", a.id)
        if (!field) fail("NOT_FOUND", "field_not_found", op)
        const patch: Partial<CustomFieldDoc> = {}
        if (a.name !== undefined) patch.name = cleanText(a.name, MAX_NAME, "name", op)!
        if (a.options !== undefined) {
          if (field.type !== "select") fail("VALIDATION", "options_on_non_select", op, ["options"])
          const options = [...new Set(a.options.map((o) => o.trim()).filter(Boolean))]
          if (options.length === 0 || options.length > 100) fail("VALIDATION", "invalid_options", op, ["options"])
          patch.options = options
        }
        await db.patch("docCustomFields", field._id, patch)
        await recordAudit(sys, actor, { action: "documents.custom_field.update", targetType: "docCustomFields", targetId: field._id, changes: { fields: Object.keys(patch) } })
        return { operationId: op }
      },
    }),

    deleteCustomField: mutationGeneric({
      args: { ...actorArgs, id: v.id("docCustomFields") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const field = await getDoc(db, "docCustomFields", a.id)
        if (!field) fail("NOT_FOUND", "field_not_found", op)
        await db.delete("docCustomFields", field._id)
        await reindex(
          db,
          (d) => field._id in d.custom,
          (d) => ({ custom: Object.fromEntries(Object.entries(d.custom).filter(([k]) => k !== field._id)) }),
        )
        await recordAudit(sys, actor, { action: "documents.custom_field.delete", targetType: "docCustomFields", targetId: field._id, changes: { name: field.name } })
        return { operationId: op }
      },
    }),

    saveView: mutationGeneric({
      args: { ...actorArgs, id: v.optional(v.id("docSavedViews")), name: v.string(), filters: viewFilterValidator, showInSidebar: v.boolean() },
      handler: async (ctx, a): Promise<{ id: SavedViewId; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const name = cleanText(a.name, MAX_NAME, "name", op)!
        const filters = cleanFilters(a.filters, op)
        let id: SavedViewId
        if (a.id) {
          const view = await getDoc(db, "docSavedViews", a.id)
          if (!view) fail("NOT_FOUND", "view_not_found", op)
          await db.patch("docSavedViews", view._id, { name, filters, showInSidebar: a.showInSidebar })
          id = view._id
        } else {
          const all = await db.query("docSavedViews").collect()
          if (all.length >= 50) fail("CONFLICT", "too_many_views", op)
          id = await db.insert("docSavedViews", { name, filters, showInSidebar: a.showInSidebar, position: all.length })
        }
        await recordAudit(sys, actor, { action: a.id ? "documents.view.update" : "documents.view.create", targetType: "docSavedViews", targetId: id, changes: { name } })
        return { id, operationId: op }
      },
    }),

    deleteView: mutationGeneric({
      args: { ...actorArgs, id: v.id("docSavedViews") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const db = dbOf(ctx)
        const view = await getDoc(db, "docSavedViews", a.id)
        if (!view) fail("NOT_FOUND", "view_not_found", sys.operationId)
        await db.delete("docSavedViews", view._id)
        await recordAudit(sys, actor, { action: "documents.view.delete", targetType: "docSavedViews", targetId: view._id, changes: { name: view.name } })
        return { operationId: sys.operationId }
      },
    }),

    // ------------------------------------------------------------ documents

    listDocuments: queryGeneric({
      args: {
        ...actorArgs,
        filters: v.optional(viewFilterValidator),
        trashed: v.optional(v.boolean()),
        sort: v.optional(sortKeys),
        direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
        limit: v.optional(v.number()),
      },
      handler: async (ctx, a): Promise<DocumentListResult> => {
        const { viewer } = await guard(ctx, DocumentsPermissions.read, a)
        const db = dbOf(ctx)
        const f = a.filters ?? {}
        const tags = tagMapOf(await taxonomy(db))
        const { rows, truncated } = await queryDocuments(db, { ...f, trashed: a.trashed }, viewer, tags)
        const sort = a.sort ?? (f.search ? "relevance" : "added")
        const dir = (a.direction ?? (sort === "title" ? "asc" : "desc")) === "asc" ? 1 : -1
        const sorted =
          sort === "relevance"
            ? rows
            : [...rows].sort((x, y) => {
                const c =
                  sort === "title"
                    ? x.title.localeCompare(y.title)
                    : sort === "asn"
                      ? x.asn - y.asn
                      : sort === "date"
                        ? (x.documentDate ?? "").localeCompare(y.documentDate ?? "")
                        : x._creationTime - y._creationTime
                return c * dir
              })
        const limit = Math.min(Math.max(a.limit ?? 100, 1), 500)
        return { documents: await Promise.all(sorted.slice(0, limit).map((d) => documentView(ctx, d, viewer, tags))), total: rows.length, truncated }
      },
    }),

    getDocument: queryGeneric({
      args: { ...actorArgs, documentId: v.string() },
      handler: async (ctx, a): Promise<DocumentDetail | null> => {
        const { actor, viewer } = await guard(ctx, DocumentsPermissions.read, a)
        const db = dbOf(ctx)
        const tags = tagMapOf(await taxonomy(db))
        const d = await getDoc(db, "docDocuments", a.documentId)
        if (!d || !canSeeDocument(viewer, d, tags)) return null
        const notes = await db
          .query("docNotes")
          .withIndex("by_document", (q) => q.eq("documentId", d._id))
          .order("desc")
          .take(200)
        const me = actorId(actor)
        const restricted = restrictedTagsOf(d, tags)
        const attachments = (
          await db
            .query("docDocuments")
            .withIndex("by_parent", (q) => q.eq("parentId", d._id))
            .take(100)
        ).filter((x) => !x.trashed && canSeeDocument(viewer, x, tags))
        return {
          document: await documentView(ctx, d, viewer, tags),
          content: d.content,
          sha256: d.sha256,
          fileUrl: await ctx.storage.getUrl(d.storageId),
          processingError: d.processingError ?? null,
          notes: notes.map((n) => ({ id: n._id, body: n.body, authorName: n.authorName, mine: n.createdBy === me, createdAt: n._creationTime })),
          submissionId: d.submissionId ?? null,
          access: {
            sharedUserIds: d.sharedUserIds ?? [],
            sharedRoleIds: d.sharedRoleIds ?? [],
            restrictedTagIds: restricted.filter((t) => canSeeTag(viewer, t)).map((t) => t._id),
          },
          attachments: attachments.map((x) => ({ id: x._id, title: x.title, fileName: x.fileName, mimeType: x.mimeType, size: x.size })),
        }
      },
    }),

    /** A short-lived URL to upload one file to Convex storage; then `createDocument`. */
    generateUploadUrl: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<string> => {
        await system.requirePermission(ctx, DocumentsPermissions.create, opts(a))
        return ctx.storage.generateUploadUrl()
      },
    }),

    /**
     * Files an uploaded file. The uploader sends what the browser read from it
     * (PDF text layer, page count, a thumbnail, page images of scans); the
     * matching rules run now, text recognition and `auto` labels in the background.
     */
    createDocument: mutationGeneric({
      args: {
        ...actorArgs,
        storageId: v.id("_storage"),
        fileName: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        pageCount: v.optional(v.number()),
        thumbnailId: v.optional(v.id("_storage")),
        ocrImageIds: v.optional(v.array(v.id("_storage"))),
        documentDate: v.optional(v.string()),
        tagIds: v.optional(v.array(v.id("docTags"))),
        correspondentId: v.optional(v.id("docCorrespondents")),
        typeId: v.optional(v.id("docTypes")),
      },
      handler: async (ctx, a): Promise<{ documentId: DocumentId; asn: number; duplicateOf: DocumentId | null; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.create, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const meta = await db.system.get("_storage", a.storageId)
        if (!meta) fail("NOT_FOUND", "file_not_found", op, ["storageId"])
        const extras = [...(a.thumbnailId ? [a.thumbnailId] : []), ...(a.ocrImageIds ?? [])]
        const discard = async () => {
          for (const id of [a.storageId, ...extras]) await ctx.storage.delete(id).catch(() => undefined)
        }
        if (meta.size > maxFileSize) {
          await discard()
          fail("VALIDATION", "file_too_large", op, ["storageId"])
        }
        if ((a.ocrImageIds?.length ?? 0) > 5) fail("VALIDATION", "too_many_images", op, ["ocrImageIds"])
        const fileName = cleanText(a.fileName, 255, "fileName", op)!
        const sha256 = base64ToHex(meta.sha256)
        // Same bytes: keep the original, drop the new upload (Paperless does the same). A copy
        // the uploader may not see is not revealed: their upload is filed as a document of its own,
        // so one hash can have several documents; any one the uploader sees is "the original".
        const shaTags = tagMapOf(await taxonomy(db))
        const existing = (
          await db
            .query("docDocuments")
            .withIndex("by_sha", (q) => q.eq("sha256", sha256))
            .take(50)
        ).find((d) => canSeeDocument(viewer, d, shaTags))
        if (existing) {
          await discard()
          return { documentId: existing._id, asn: existing.asn, duplicateOf: existing._id, operationId: op }
        }
        if (a.documentDate !== undefined && !isDate(a.documentDate)) fail("VALIDATION", "invalid_date", op, ["documentDate"])
        await checkLabels(db, op, a, viewer)
        const content = (a.content ?? "").slice(0, MAX_CONTENT)
        const tx = await taxonomy(db)
        const inbox = tx.tags.filter((t) => t.isInbox).map((t) => t._id)
        const labels = applyRules(tx, content, { tagIds: [...new Set([...(a.tagIds ?? []), ...inbox])], correspondentId: a.correspondentId, typeId: a.typeId })
        const mimeType = meta.contentType || "application/octet-stream"
        const needsOcr = content.trim().length < OCR_MIN_CHARS && ((a.ocrImageIds?.length ?? 0) > 0 || OCR_IMAGE_TYPES.has(mimeType))
        const ai = await isFeatureEnabled(sys, DocumentsFlags.ai)
        const queue = ai && (needsOcr || hasAuto(tx))
        const asn = await nextAsn(db)
        const title = cleanText(a.title, MAX_TITLE, "title", op, false) ?? titleFromFile(fileName)
        const base = {
          title,
          fileName,
          content,
          asn,
          tagIds: labels.tagIds,
          ...(labels.correspondentId ? { correspondentId: labels.correspondentId as DocumentDoc["correspondentId"] } : {}),
          ...(labels.typeId ? { typeId: labels.typeId as DocumentDoc["typeId"] } : {}),
          custom: {},
        }
        const by = actorId(actor)
        const documentId = await db.insert("docDocuments", {
          ...base,
          storageId: a.storageId,
          ...(a.thumbnailId ? { thumbnailId: a.thumbnailId } : {}),
          ocrImageIds: a.ocrImageIds ?? [],
          mimeType,
          size: meta.size,
          sha256,
          ...(a.pageCount && Number.isInteger(a.pageCount) && a.pageCount > 0 ? { pageCount: a.pageCount } : {}),
          contentSource: content.trim() ? "pdf" : "none",
          processing: queue ? "queued" : "done",
          ...(a.documentDate ? { documentDate: a.documentDate } : {}),
          searchText: searchTextOf(base, tx),
          trashed: false,
          addedBy: by,
          updatedAt: Date.now(),
        })
        if (queue) await ctx.scheduler.runAfter(0, ref("_processDocument") as never, { documentId } as never)
        await recordAudit(sys, actor, { action: "documents.document.create", targetType: "docDocuments", targetId: documentId, changes: { asn, fileName, size: meta.size, sha256 } })
        return { documentId, asn, duplicateOf: null, operationId: op }
      },
    }),

    /** Partial update; `null` clears a date, correspondent, type or custom value. */
    updateDocument: mutationGeneric({
      args: {
        ...actorArgs,
        documentId: v.id("docDocuments"),
        title: v.optional(v.string()),
        documentDate: v.optional(v.union(v.string(), v.null())),
        correspondentId: v.optional(v.union(v.id("docCorrespondents"), v.null())),
        typeId: v.optional(v.union(v.id("docTypes"), v.null())),
        tagIds: v.optional(v.array(v.id("docTags"))),
        custom: v.optional(v.record(v.string(), v.any())),
        content: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.update, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const tags = tagMapOf(await taxonomy(db))
        const d = await requireDocument(db, a.documentId, op, viewer, tags)
        await checkLabels(db, op, { ...a, tagIds: a.tagIds?.filter((t) => !d.tagIds.includes(t)) }, viewer)
        const patch: Partial<DocumentDoc> = {}
        if (a.title !== undefined) patch.title = cleanText(a.title, MAX_TITLE, "title", op)!
        if (a.documentDate !== undefined) {
          if (a.documentDate !== null && !isDate(a.documentDate)) fail("VALIDATION", "invalid_date", op, ["documentDate"])
          patch.documentDate = a.documentDate ?? undefined
        }
        if (a.correspondentId !== undefined) patch.correspondentId = a.correspondentId ?? undefined
        if (a.typeId !== undefined) patch.typeId = a.typeId ?? undefined
        if (a.tagIds !== undefined) {
          // Labels the editor cannot see stay on the document.
          const merged = mergeTagIds(viewer, d.tagIds, a.tagIds, tags)
          if (!merged) fail("VALIDATION", "invalid_tag", op, ["tagIds"])
          patch.tagIds = merged
        }
        if (a.content !== undefined) {
          patch.content = a.content.slice(0, MAX_CONTENT)
          patch.contentSource = "manual"
        }
        if (a.custom !== undefined) {
          const fields = await db.query("docCustomFields").collect()
          const bad = customProblems(fields, a.custom)
          if (bad.length) fail("VALIDATION", "invalid_custom", op, bad)
          const custom = { ...d.custom }
          for (const [k, val] of Object.entries(a.custom)) {
            if (val === null) delete custom[k]
            else custom[k] = val
          }
          patch.custom = custom
        }
        const changed = Object.keys(patch)
        if (changed.length === 0) return { operationId: op }
        const tx = await taxonomy(db)
        await db.patch("docDocuments", d._id, { ...patch, searchText: searchTextOf({ ...d, ...patch }, tx), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "documents.document.update", targetType: "docDocuments", targetId: d._id, changes: { fields: changed } })
        return { operationId: op }
      },
    }),

    /** The same change on many documents: add or remove tags, set correspondent or type. */
    bulkEditDocuments: mutationGeneric({
      args: {
        ...actorArgs,
        documentIds: v.array(v.id("docDocuments")),
        addTagIds: v.optional(v.array(v.id("docTags"))),
        removeTagIds: v.optional(v.array(v.id("docTags"))),
        correspondentId: v.optional(v.union(v.id("docCorrespondents"), v.null())),
        typeId: v.optional(v.union(v.id("docTypes"), v.null())),
      },
      handler: async (ctx, a): Promise<{ count: number; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.update, a)
        const op = sys.operationId
        if (a.documentIds.length === 0 || a.documentIds.length > MAX_BULK) fail("VALIDATION", "invalid_count", op, ["documentIds"])
        const db = dbOf(ctx)
        await checkLabels(db, op, { tagIds: [...(a.addTagIds ?? []), ...(a.removeTagIds ?? [])], correspondentId: a.correspondentId, typeId: a.typeId }, viewer)
        const tx = await taxonomy(db)
        const tags = tagMapOf(tx)
        for (const id of a.documentIds) {
          const d = await requireDocument(db, id, op, viewer, tags)
          const patch: Partial<DocumentDoc> = {}
          if (a.addTagIds?.length || a.removeTagIds?.length) {
            const remove = new Set<string>(a.removeTagIds ?? [])
            patch.tagIds = [...new Set([...d.tagIds, ...(a.addTagIds ?? [])])].filter((t) => !remove.has(t))
          }
          if (a.correspondentId !== undefined) patch.correspondentId = a.correspondentId ?? undefined
          if (a.typeId !== undefined) patch.typeId = a.typeId ?? undefined
          await db.patch("docDocuments", d._id, { ...patch, searchText: searchTextOf({ ...d, ...patch }, tx), updatedAt: Date.now() })
        }
        await recordAudit(sys, actor, {
          action: "documents.document.bulk_edit",
          targetType: "docDocuments",
          targetId: a.documentIds[0]!,
          changes: { count: a.documentIds.length, addTags: a.addTagIds?.length ?? 0, removeTags: a.removeTagIds?.length ?? 0, correspondent: a.correspondentId !== undefined, type: a.typeId !== undefined },
        })
        return { count: a.documentIds.length, operationId: op }
      },
    }),

    setDocumentsTrashed: mutationGeneric({
      args: { ...actorArgs, documentIds: v.array(v.id("docDocuments")), trashed: v.boolean() },
      handler: async (ctx, a): Promise<{ count: number; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.delete, a)
        const op = sys.operationId
        if (a.documentIds.length === 0 || a.documentIds.length > MAX_BULK) fail("VALIDATION", "invalid_count", op, ["documentIds"])
        const db = dbOf(ctx)
        const tags = tagMapOf(await taxonomy(db))
        for (const id of a.documentIds) {
          const d = await requireDocument(db, id, op, viewer, tags)
          await db.patch("docDocuments", d._id, { trashed: a.trashed, updatedAt: Date.now() })
          await recordAudit(sys, actor, { action: a.trashed ? "documents.document.trash" : "documents.document.restore", targetType: "docDocuments", targetId: d._id })
        }
        return { count: a.documentIds.length, operationId: op }
      },
    }),

    /** Deletes documents in the trash for good, files included (unless a signing template still uses the file). */
    deleteDocuments: mutationGeneric({
      args: { ...actorArgs, documentIds: v.array(v.id("docDocuments")) },
      handler: async (ctx, a): Promise<{ count: number; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.delete, a)
        const op = sys.operationId
        if (a.documentIds.length === 0 || a.documentIds.length > MAX_BULK) fail("VALIDATION", "invalid_count", op, ["documentIds"])
        const db = dbOf(ctx)
        const templates = await db.query("docTemplates").collect()
        const tags = tagMapOf(await taxonomy(db))
        for (const id of a.documentIds) {
          const d = await requireDocument(db, id, op, viewer, tags)
          if (!d.trashed) fail("CONFLICT", "not_in_trash", op)
          const inUse = templates.some((t) => t.storageId === d.storageId)
          for (const sid of [...(inUse || d.submissionId ? [] : [d.storageId]), ...(d.thumbnailId ? [d.thumbnailId] : []), ...d.ocrImageIds]) await ctx.storage.delete(sid).catch(() => undefined)
          for (const n of await db
            .query("docNotes")
            .withIndex("by_document", (q) => q.eq("documentId", d._id))
            .collect())
            await db.delete("docNotes", n._id)
          for (const t of templates.filter((t) => t.documentId === d._id)) await db.patch("docTemplates", t._id, { documentId: undefined })
          for (const c of await db
            .query("docDocuments")
            .withIndex("by_parent", (q) => q.eq("parentId", d._id))
            .collect())
            await db.patch("docDocuments", c._id, { parentId: undefined })
          await db.delete("docDocuments", d._id)
          await recordAudit(sys, actor, { action: "documents.document.delete", targetType: "docDocuments", targetId: d._id, changes: { asn: d.asn, sha256: d.sha256 } })
        }
        return { count: a.documentIds.length, operationId: op }
      },
    }),

    /** Runs the matching rules again (and text recognition / `auto` labels when AI is on). */
    reprocessDocument: mutationGeneric({
      args: { ...actorArgs, documentId: v.id("docDocuments") },
      handler: async (ctx, a): Promise<{ queued: boolean; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.update, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const tx = await taxonomy(db)
        const d = await requireDocument(db, a.documentId, op, viewer, tagMapOf(tx))
        const labels = applyRules(tx, d.content, d)
        const ai = await isFeatureEnabled(sys, DocumentsFlags.ai)
        const patch = { tagIds: labels.tagIds, correspondentId: labels.correspondentId as DocumentDoc["correspondentId"], typeId: labels.typeId as DocumentDoc["typeId"] }
        await db.patch("docDocuments", d._id, { ...patch, processing: ai ? "queued" : "done", processingError: undefined, searchText: searchTextOf({ ...d, ...patch }, tx), updatedAt: Date.now() })
        if (ai) await ctx.scheduler.runAfter(0, ref("_processDocument") as never, { documentId: d._id, force: true } as never)
        await recordAudit(sys, actor, { action: "documents.document.reprocess", targetType: "docDocuments", targetId: d._id })
        return { queued: ai, operationId: op }
      },
    }),

    addNote: mutationGeneric({
      args: { ...actorArgs, documentId: v.id("docDocuments"), body: v.string() },
      handler: async (ctx, a): Promise<{ noteId: NoteId; operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.update, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const d = await requireDocument(db, a.documentId, op, viewer, tagMapOf(await taxonomy(db)))
        const body = cleanText(a.body, MAX_NOTE, "body", op)!
        const noteId = await db.insert("docNotes", { documentId: d._id, body, createdBy: actorId(actor), authorName: await displayName(sys as never, actor) })
        await recordAudit(sys, actor, { action: "documents.note.create", targetType: "docDocuments", targetId: d._id })
        return { noteId, operationId: op }
      },
    }),

    /** Authors delete their own notes; `documents:document:delete` deletes anyone's. */
    deleteNote: mutationGeneric({
      args: { ...actorArgs, noteId: v.id("docNotes") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.update, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const note = await getDoc(db, "docNotes", a.noteId)
        if (!note) fail("NOT_FOUND", "note_not_found", op)
        await requireDocument(db, note.documentId, op, viewer, tagMapOf(await taxonomy(db)))
        if (note.createdBy !== actorId(actor)) await system.requirePermission(ctx, DocumentsPermissions.delete, opts(a))
        await db.delete("docNotes", note._id)
        await recordAudit(sys, actor, { action: "documents.note.delete", targetType: "docDocuments", targetId: note.documentId })
        return { operationId: op }
      },
    }),

    // ------------------------------------------------------------ sharing

    /**
     * Shares a document with roles and users (replaces both lists). A shared
     * document is visible only to them, its uploader, grantees of its restricted
     * labels and `documents:document:all`. Empty lists: not shared.
     */
    shareDocument: mutationGeneric({
      args: { ...actorArgs, documentId: v.id("docDocuments"), userIds: v.array(v.string()), roleIds: v.array(v.string()) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor, viewer } = await guard(ctx, DocumentsPermissions.share, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const tags = tagMapOf(await taxonomy(db))
        const d = await requireDocument(db, a.documentId, op, viewer, tags)
        // Someone who sees it only because it was shared with them may not change (or lift) the share.
        const owns = viewer.all || viewer.ids.has(d.addedBy) || restrictedTagsOf(d, tags).some((t) => canSeeTag(viewer, t))
        if (isShared(d) && !owns) fail("FORBIDDEN", "share_not_owner", op)
        const grants = await checkGrants(sys, op, { userIds: a.userIds, roleIds: a.roleIds })
        await db.patch("docDocuments", d._id, {
          sharedUserIds: grants.userIds.length ? grants.userIds : undefined,
          sharedRoleIds: grants.roleIds.length ? grants.roleIds : undefined,
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "documents.document.share", targetType: "docDocuments", targetId: d._id, changes: { userIds: grants.userIds, roleIds: grants.roleIds } })
        return { operationId: op }
      },
    }),

    /** Roles and active users to pick from when sharing or restricting a label. */
    getAccessOptions: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<AccessOptions> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.read, opts(a))
        const may = (await decide(sys, actor, DocumentsPermissions.share)).allowed || (await decide(sys, actor, DocumentsPermissions.manageLabels)).allowed
        if (!may) fail("FORBIDDEN", "not_granted", sys.operationId)
        const users: { key: string; email: string; displayName?: string | undefined; status: string }[] = []
        let cursor: string | null = null
        do {
          const page: { items: typeof users; cursor: string | null; done: boolean } = await sys.store.page("users", { cursor, limit: 200 })
          users.push(...page.items)
          cursor = page.done ? null : page.cursor
        } while (cursor && users.length < 2000)
        return {
          roles: (await sys.store.all("roles"))
            .filter((r) => !r.archived)
            .map((r) => ({ id: r.key, name: r.name }))
            .sort((x, y) => x.name.localeCompare(y.name)),
          users: users
            .filter((u) => u.status === "active")
            .map((u) => ({ id: u.key, name: u.displayName || u.email, email: u.email }))
            .sort((x, y) => x.name.localeCompare(y.name)),
        }
      },
    }),

    // ------------------------------------------------------------ background processing

    _processContext: internalQueryGeneric({
      args: { documentId: v.id("docDocuments") },
      handler: async (ctx, a) => {
        const db = dbOf(ctx)
        const d = await getDoc(db, "docDocuments", a.documentId)
        if (!d) return null
        const { sys } = await system.context(ctx)
        const tx = await taxonomy(db)
        const auto = <T extends { _id: string; name: string; algorithm: MatchAlgorithm }>(xs: T[]) => xs.filter((x) => x.algorithm === "auto").map((x) => ({ id: x._id as string, name: x.name }))
        return {
          ai: await isFeatureEnabled(sys, DocumentsFlags.ai),
          storageId: d.storageId,
          mimeType: d.mimeType,
          ocrImageIds: d.ocrImageIds as string[],
          content: d.content,
          fileName: d.fileName,
          titleIsDefault: d.title === titleFromFile(d.fileName),
          hasDate: Boolean(d.documentDate),
          tags: auto(tx.tags),
          correspondents: d.correspondentId ? [] : auto(tx.correspondents),
          types: d.typeId ? [] : auto(tx.types),
        }
      },
    }),

    _processDocument: internalActionGeneric({
      args: { documentId: v.id("docDocuments"), force: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<void> => {
        const c = (await ctx.runQuery(ref("_processContext") as never, { documentId: a.documentId } as never)) as {
          ai: boolean
          storageId: string
          mimeType: string
          ocrImageIds: string[]
          content: string
          fileName: string
          titleIsDefault: boolean
          hasDate: boolean
          tags: { id: string; name: string }[]
          correspondents: { id: string; name: string }[]
          types: { id: string; name: string }[]
        } | null
        if (!c) return
        const cfg = aiConfig()
        let content: string | undefined
        let error: string | undefined
        if (c.ai && c.content.trim().length < OCR_MIN_CHARS) {
          const ids = c.ocrImageIds.length ? c.ocrImageIds : OCR_IMAGE_TYPES.has(c.mimeType) ? [c.storageId] : []
          const images: string[] = []
          for (const id of ids) {
            const blob = await ctx.storage.get(id as StorageId)
            if (blob && blob.size <= 8 * 1024 * 1024) images.push(`data:${blob.type || "image/jpeg"};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`)
          }
          if (images.length) {
            const res = await recognizeText(cfg, images)
            if (res.ok) content = res.value
            else error = res.code === "AI_NOT_CONFIGURED" ? res.code : `${res.code}: ${res.message}`
          }
        }
        const text = content ?? c.content
        let classification: unknown
        const wantsAi = c.tags.length + c.correspondents.length + c.types.length > 0 || c.titleIsDefault || !c.hasDate
        if (c.ai && !error && text.trim() && wantsAi && (c.tags.length || c.correspondents.length || c.types.length || content !== undefined || a.force)) {
          const res = await classifyDocument(cfg, { content: text, fileName: c.fileName, tags: c.tags, correspondents: c.correspondents, types: c.types, wantTitle: c.titleIsDefault, wantDate: !c.hasDate })
          if (res.ok) classification = res.value
          else if (res.code !== "AI_NOT_CONFIGURED") error = `${res.code}: ${res.message}`
        }
        await ctx.runMutation(ref("_applyProcessing") as never, { documentId: a.documentId, ...(content !== undefined ? { content } : {}), ...(classification ? { classification } : {}), ...(error ? { error } : {}) } as never)
      },
    }),

    _applyProcessing: internalMutationGeneric({
      args: {
        documentId: v.id("docDocuments"),
        content: v.optional(v.string()),
        classification: v.optional(
          v.object({ title: v.union(v.string(), v.null()), date: v.union(v.string(), v.null()), tagIds: v.array(v.string()), correspondentId: v.union(v.string(), v.null()), typeId: v.union(v.string(), v.null()) }),
        ),
        error: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<void> => {
        const db = dbOf(ctx)
        const d = await getDoc(db, "docDocuments", a.documentId)
        if (!d) return
        const { sys } = await system.context(ctx)
        const tx = await taxonomy(db)
        const content = a.content !== undefined ? a.content.slice(0, MAX_CONTENT) : d.content
        const labels = applyRules(tx, content, d)
        const k = a.classification
        // AI suggestions only fill what is empty and only use labels that still exist.
        const tagIds = [...new Set([...labels.tagIds, ...((k?.tagIds ?? []).filter((t) => tx.tags.some((x) => x._id === t)) as TagId[])])]
        const correspondentId = labels.correspondentId ?? (k?.correspondentId && tx.correspondents.some((x) => x._id === k.correspondentId) ? k.correspondentId : undefined)
        const typeId = labels.typeId ?? (k?.typeId && tx.types.some((x) => x._id === k.typeId) ? k.typeId : undefined)
        const patch: Partial<DocumentDoc> = {
          content,
          tagIds,
          correspondentId: correspondentId as DocumentDoc["correspondentId"],
          typeId: typeId as DocumentDoc["typeId"],
          processing: a.error && a.error !== "AI_NOT_CONFIGURED" ? "failed" : "done",
          processingError: a.error,
        }
        if (a.content !== undefined) patch.contentSource = a.content.trim() ? "ai" : d.contentSource
        if (k?.title && d.title === titleFromFile(d.fileName)) patch.title = k.title
        if (k?.date && !d.documentDate && isDate(k.date)) patch.documentDate = k.date
        await db.patch("docDocuments", d._id, { ...patch, searchText: searchTextOf({ ...d, ...patch }, tx), updatedAt: Date.now() })
        await recordAudit(sys, "system", {
          action: "documents.document.process",
          targetType: "docDocuments",
          targetId: d._id,
          result: patch.processing === "failed" ? "failed" : "success",
          changes: { ocr: a.content !== undefined, ai: Boolean(k), ...(a.error ? { error: a.error.slice(0, 200) } : {}) },
        })
      },
    }),

    /**
     * Files a received email (its PDF and attachments, already in storage) into
     * the archive: tagged "El. laiškas" (restricted to `documents:document:all`
     * until someone grants more) plus every inbox it reached (from the email
     * queue), correspondent = sender.
     */
    _fileEmail: internalMutationGeneric({
      args: {
        emailKey: v.string(),
        inboxName: v.string(),
        subject: v.string(),
        sender: v.string(),
        receivedAt: v.number(),
        content: v.string(),
        storageId: v.id("_storage"),
        attachments: v.array(v.object({ storageId: v.id("_storage"), fileName: v.string() })),
        error: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ documentId: DocumentId; duplicate: boolean }> => {
        const db = dbOf(ctx)
        const { sys } = await system.context(ctx)
        const drop = async (ids: StorageId[]) => {
          for (const id of ids) await ctx.storage.delete(id).catch(() => undefined)
        }
        const queued = await db
          .query("docEmailQueue")
          .withIndex("by_email", (q) => q.eq("emailKey", a.emailKey))
          .first()
        if (queued) await db.delete("docEmailQueue", queued._id)
        const inboxNames = [...new Set([a.inboxName, ...(queued?.inboxNames ?? [])])]
        const inboxTags: TagId[] = []
        for (const name of inboxNames) inboxTags.push(await ensureTag(db, name.slice(0, MAX_NAME), {}, "#3b82f6"))
        const existing = await db
          .query("docDocuments")
          .withIndex("by_email", (q) => q.eq("emailKey", a.emailKey))
          .first()
        if (existing) {
          await drop([a.storageId, ...a.attachments.map((x) => x.storageId)])
          await addEmailTags(db, existing, inboxTags)
          return { documentId: existing._id, duplicate: true }
        }
        const mailTag = await emailTag(db)
        const senderName = a.sender.trim().slice(0, MAX_NAME) || "?"
        const correspondentId =
          (
            await db
              .query("docCorrespondents")
              .withIndex("by_name", (q) => q.eq("name", senderName))
              .first()
          )?._id ?? (await db.insert("docCorrespondents", { name: senderName, match: "", algorithm: "none", caseSensitive: false }))
        const tx = await taxonomy(db)
        const ai = await isFeatureEnabled(sys, DocumentsFlags.ai)
        const date = new Date(a.receivedAt).toISOString().slice(0, 10)
        const file = async (f: { storageId: StorageId; fileName: string; title: string; content: string; parentId?: DocumentId }): Promise<DocumentId | null> => {
          const meta = await db.system.get("_storage", f.storageId)
          if (!meta) return null
          const sha256 = base64ToHex(meta.sha256)
          if (
            await db
              .query("docDocuments")
              .withIndex("by_sha", (q) => q.eq("sha256", sha256))
              .first()
          ) {
            // The same file is already in the archive (e.g. the invoice sent twice).
            await drop([f.storageId])
            return null
          }
          const content = f.content.slice(0, MAX_CONTENT)
          const labels = applyRules(tx, content, { tagIds: [mailTag, ...inboxTags], correspondentId })
          const mimeType = meta.contentType || "application/octet-stream"
          const queue = ai && ((content.trim().length < OCR_MIN_CHARS && OCR_IMAGE_TYPES.has(mimeType)) || hasAuto(tx))
          const base = {
            title: f.title.slice(0, MAX_TITLE),
            fileName: f.fileName.slice(0, 255),
            content,
            asn: await nextAsn(db),
            tagIds: labels.tagIds,
            correspondentId: labels.correspondentId as DocumentDoc["correspondentId"],
            ...(labels.typeId ? { typeId: labels.typeId as DocumentDoc["typeId"] } : {}),
            custom: {},
          }
          const id = await db.insert("docDocuments", {
            ...base,
            storageId: f.storageId,
            ocrImageIds: [],
            mimeType,
            size: meta.size,
            sha256,
            contentSource: content.trim() ? "pdf" : "none",
            processing: queue ? "queued" : "done",
            ...(f.parentId ? { parentId: f.parentId } : { emailKey: a.emailKey, ...(a.error ? { processingError: a.error.slice(0, 500) } : {}) }),
            documentDate: date,
            searchText: searchTextOf(base, tx),
            trashed: false,
            addedBy: EMAIL_UPLOADER,
            updatedAt: Date.now(),
          })
          if (queue) await ctx.scheduler.runAfter(0, ref("_processDocument") as never, { documentId: id } as never)
          return id
        }
        const subject = a.subject.trim() || "(be temos)"
        const pdfMeta = await db.system.get("_storage", a.storageId)
        const pdfSha = pdfMeta ? base64ToHex(pdfMeta.sha256) : ""
        const documentId = await file({ storageId: a.storageId, fileName: `${safeFileName(subject)}.pdf`, title: subject, content: a.content })
        if (!documentId) {
          // A byte-identical PDF is already filed (or the file vanished): keep what is there.
          await drop(a.attachments.map((x) => x.storageId))
          const same = pdfSha
            ? await db
                .query("docDocuments")
                .withIndex("by_sha", (q) => q.eq("sha256", pdfSha))
                .first()
            : null
          if (!same) fail("NOT_FOUND", "file_not_found", sys.operationId)
          return { documentId: same._id, duplicate: true }
        }
        let filed = 0
        for (const att of a.attachments) if (await file({ storageId: att.storageId, fileName: att.fileName, title: titleFromFile(att.fileName), content: "", parentId: documentId })) filed++
        await recordAudit(sys, "system", { action: "documents.email.archive", targetType: "docDocuments", targetId: documentId, changes: { attachments: filed, inboxes: inboxNames, ...(a.error ? { error: a.error.slice(0, 200) } : {}) } })
        return { documentId, duplicate: false }
      },
    }),

    /**
     * The same email reached another inbox: adds that inbox's label to the filed
     * email (and its attachments), or to the queue while it is still being filed.
     */
    _addEmailInbox: internalMutationGeneric({
      args: { emailKey: v.string(), inboxName: v.string() },
      handler: async (ctx, a): Promise<void> => {
        const db = dbOf(ctx)
        const existing = await db
          .query("docDocuments")
          .withIndex("by_email", (q) => q.eq("emailKey", a.emailKey))
          .first()
        if (existing) return addEmailTags(db, existing, [await ensureTag(db, a.inboxName.slice(0, MAX_NAME), {}, "#3b82f6")])
        const queued = await db
          .query("docEmailQueue")
          .withIndex("by_email", (q) => q.eq("emailKey", a.emailKey))
          .first()
        if (queued && !queued.inboxNames.includes(a.inboxName)) await db.patch("docEmailQueue", queued._id, { inboxNames: [...queued.inboxNames, a.inboxName] })
      },
    }),

    /** Files a signed PDF into the archive (used by signing). */
    _fileSignedDocument: internalMutationGeneric({
      args: { storageId: v.id("_storage"), title: v.string(), fileName: v.string(), content: v.string(), submissionId: v.id("docSubmissions"), addedBy: v.string() },
      handler: async (ctx, a): Promise<DocumentId> => {
        const db = dbOf(ctx)
        const meta = await db.system.get("_storage", a.storageId)
        const tx = await taxonomy(db)
        // The signed copy keeps the labels and shares of the document it was made from (so access carries over).
        const submission = await getDoc(db, "docSubmissions", a.submissionId)
        const template = submission ? await getDoc(db, "docTemplates", submission.templateId) : null
        const source = template?.documentId ? await getDoc(db, "docDocuments", template.documentId) : null
        const labels = applyRules(tx, a.content, { tagIds: source?.tagIds ?? [] })
        const asn = await nextAsn(db)
        const base = {
          title: a.title.slice(0, MAX_TITLE),
          fileName: a.fileName,
          content: a.content.slice(0, MAX_CONTENT),
          asn,
          tagIds: labels.tagIds,
          ...(labels.correspondentId ? { correspondentId: labels.correspondentId as DocumentDoc["correspondentId"] } : {}),
          ...(labels.typeId ? { typeId: labels.typeId as DocumentDoc["typeId"] } : {}),
          custom: {},
        }
        return db.insert("docDocuments", {
          ...base,
          storageId: a.storageId,
          ocrImageIds: [],
          mimeType: "application/pdf",
          size: meta?.size ?? 0,
          sha256: meta ? base64ToHex(meta.sha256) : "",
          contentSource: a.content ? "pdf" : "none",
          processing: "done",
          documentDate: new Date().toISOString().slice(0, 10),
          searchText: searchTextOf(base, tx),
          trashed: false,
          submissionId: a.submissionId,
          addedBy: a.addedBy,
          ...(source?.sharedUserIds?.length ? { sharedUserIds: source.sharedUserIds } : {}),
          ...(source?.sharedRoleIds?.length ? { sharedRoleIds: source.sharedRoleIds } : {}),
          updatedAt: Date.now(),
        })
      },
    }),
  }
}

export type { StorageId, TagId, DocTypeId }
