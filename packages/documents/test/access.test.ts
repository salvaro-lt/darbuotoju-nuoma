import { describe, expect, test } from "vitest"
import { canSeeDocument, canSeeTag, mergeTagIds, visibleTagIds, type Viewer } from "../src/access"

const viewer = (ids: string[], roleIds: string[] = [], all = false): Viewer => ({ all, ids: new Set(ids), roleIds: new Set(roleIds) })
const tags = new Map([
  ["public", { _id: "public" }],
  ["hr", { _id: "hr", access: { userIds: [], roleIds: ["role_hr"] } }],
  ["boss", { _id: "boss", access: { userIds: ["u_boss"], roleIds: [] } }],
  ["mail", { _id: "mail", access: { userIds: [], roleIds: [] } }],
])
const doc = (tagIds: string[], extra: { addedBy?: string; sharedUserIds?: string[]; sharedRoleIds?: string[] } = {}) => ({ tagIds, addedBy: extra.addedBy ?? "u_up", ...extra })

describe("documents access rules", () => {
  test("documents without restricted labels or shares are visible to every reader", () => {
    expect(canSeeDocument(viewer(["u_a"]), doc([]), tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_a"]), doc(["public", "gone"]), tags)).toBe(true)
  })

  test("a restricted label opens the document to its users and roles only", () => {
    expect(canSeeDocument(viewer(["u_a"]), doc(["hr"]), tags)).toBe(false)
    expect(canSeeDocument(viewer(["u_a"], ["role_hr"]), doc(["hr"]), tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_boss"]), doc(["boss"]), tags)).toBe(true)
  })

  test("any grant opens: one granted restricted label is enough", () => {
    expect(canSeeDocument(viewer(["u_a"], ["role_hr"]), doc(["hr", "boss"]), tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_a"]), doc(["hr", "boss"]), tags)).toBe(false)
  })

  test("a restricted label with no grants is for `all` holders only", () => {
    expect(canSeeDocument(viewer(["u_a"], ["role_hr"]), doc(["mail"]), tags)).toBe(false)
    expect(canSeeDocument(viewer(["u_a"], [], true), doc(["mail"]), tags)).toBe(true)
    expect(canSeeTag(viewer(["u_a"]), tags.get("mail")!)).toBe(false)
  })

  test("shares restrict the document to share targets, the uploader and label grantees", () => {
    const shared = doc(["hr"], { sharedRoleIds: ["role_sales"], sharedUserIds: ["u_b"] })
    expect(canSeeDocument(viewer(["u_a"]), doc([], { sharedRoleIds: ["role_sales"] }), tags)).toBe(false)
    expect(canSeeDocument(viewer(["u_a"], ["role_sales"]), shared, tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_b"]), shared, tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_c"], ["role_hr"]), shared, tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_up"]), shared, tags)).toBe(true)
    expect(canSeeDocument(viewer(["u_c"]), shared, tags)).toBe(false)
  })

  test("hidden labels are filtered from views and kept on edits", () => {
    const v = viewer(["u_a"], ["role_hr"])
    expect(visibleTagIds(v, ["public", "hr", "boss", "mail"], tags)).toEqual(["public", "hr"])
    expect(mergeTagIds(v, ["hr", "boss"], ["public"], tags)).toEqual(["boss", "public"])
    expect(mergeTagIds(v, ["boss"], ["boss", "hr"], tags)).toEqual(["boss", "hr"])
    expect(mergeTagIds(v, [], ["mail"], tags)).toBeNull()
  })
})
