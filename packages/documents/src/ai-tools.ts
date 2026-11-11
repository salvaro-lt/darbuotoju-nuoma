// AI tools of the documents module, read-only: the assistant finds archive
// documents and reports signing status. Give them to an agent:
//
//   defineAiAgent({ id: "assistant", ..., tools: [...documentsTools] })
import { defineAiTool } from "@digimuza/system-core/ai"
import { z } from "zod"
import { canSeeDocument, viewerFor, visibleTagIds } from "./access"
import { DocumentsPermissions } from "./manifest"
import { dbOf, type SubmissionDoc } from "./shared"

export const documentsSearchTool = defineAiTool({
  id: "documents.search_documents",
  description:
    "Full-text search in the document archive (title, text, tags, correspondent, type, archive number like #12). Returns the best matches with their archive number, date, labels and a short excerpt.",
  permission: DocumentsPermissions.read,
  input: z.object({
    query: z.string().trim().min(1).max(200).describe("Words to search for"),
    limit: z.number().int().min(1).max(20).optional().describe("How many results (1-20, default 8)"),
  }),
  handler: async ({ db: raw, sys, actor }, input) => {
    const db = dbOf({ db: raw })
    const viewer = await viewerFor(sys, actor)
    const tags = new Map((await db.query("docTags").collect()).map((t) => [t._id as string, t]))
    const rows = (
      await db
        .query("docDocuments")
        .withSearchIndex("search", (q) => q.search("searchText", input.query).eq("trashed", false))
        .take(100)
    )
      .filter((d) => canSeeDocument(viewer, d, tags))
      .slice(0, input.limit ?? 8)
    const names = async (table: "docCorrespondents" | "docTypes", ids: string[]) =>
      (await Promise.all(ids.map((id) => db.get(table, id).catch(() => null)))).filter(Boolean).map((x) => x!.name)
    return Promise.all(
      rows.map(async (d) => ({
        asn: d.asn,
        title: d.title,
        date: d.documentDate ?? null,
        correspondent: (await names("docCorrespondents", d.correspondentId ? [d.correspondentId] : []))[0] ?? null,
        type: (await names("docTypes", d.typeId ? [d.typeId] : []))[0] ?? null,
        tags: visibleTagIds(viewer, d.tagIds, tags).map((id) => tags.get(id)?.name).filter(Boolean),
        excerpt: d.content.replace(/\s+/g, " ").slice(0, 300),
        link: `/app/documents/${d._id}`,
      })),
    )
  },
})

export const documentsListSubmissionsTool = defineAiTool({
  id: "documents.list_submissions",
  description: "Lists documents sent for e-signing, newest first, with each signer's status. Optionally only pending, completed, declined or cancelled ones.",
  permission: DocumentsPermissions.signingRead,
  input: z.object({
    status: z.enum(["pending", "completed", "declined", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(30).optional().describe("How many (1-30, default 10)"),
  }),
  handler: async ({ db: raw }, input) => {
    const db = dbOf({ db: raw })
    const rows: SubmissionDoc[] = await db
      .query("docSubmissions")
      .order("desc")
      .take(input.status ? 200 : (input.limit ?? 10))
    const picked = rows.filter((s) => !input.status || s.status === input.status).slice(0, input.limit ?? 10)
    return Promise.all(
      picked.map(async (s) => ({
        name: s.name,
        status: s.status,
        sentAt: new Date(s._creationTime).toISOString().slice(0, 10),
        signers: (
          await db
            .query("docSubmitters")
            .withIndex("by_submission", (q) => q.eq("submissionId", s._id))
            .collect()
        ).map((x) => ({ role: s.roles[x.role] ?? "", name: x.name, email: x.email, status: x.status })),
        link: `/app/documents/signing/${s._id}`,
      })),
    )
  },
})

/** All documents tools, for an agent's `tools`. */
export const documentsTools = [documentsSearchTool, documentsListSubmissionsTool] as const
