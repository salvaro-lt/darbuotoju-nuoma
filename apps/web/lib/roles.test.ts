import { describe, expect, test } from "vitest"
import { byModule, diff, parseBlocker, permissionsOf, sameSet, toggle } from "./roles"

describe("role editor helpers", () => {
  const perms = { "a:r": ["a:x:read"], "a:w": ["a:x:read", "a:x:write"], "b:r": ["b:y:read"] }

  test("permissionsOf unions subroles and ignores unknown ones", () => {
    expect([...permissionsOf(["a:r", "a:w", "gone"], perms)].sort()).toEqual(["a:x:read", "a:x:write"])
    expect(permissionsOf([], perms).size).toBe(0)
  })

  test("diff of effective permissions", () => {
    const before = permissionsOf(["a:w"], perms)
    const after = permissionsOf(["a:r", "b:r"], perms)
    expect(diff(before, after)).toEqual({ added: ["b:y:read"], removed: ["a:x:write"] })
    expect(sameSet(["x", "y"], ["y", "x"])).toBe(true)
    expect(sameSet(["x"], ["x", "y"])).toBe(false)
  })

  test("byModule sorts modules and keeps item order", () => {
    const rows = [
      { moduleId: "roles", id: 1 },
      { moduleId: "finance", id: 2 },
      { moduleId: "roles", id: 3 },
    ]
    expect(byModule(rows).map(([m, l]) => [m, l.map((r) => r.id)])).toEqual([
      ["finance", [2]],
      ["roles", [1, 3]],
    ])
  })

  test("parseBlocker keeps colons in role IDs", () => {
    expect(parseBlocker("protected_role:system:admin")).toEqual({ reason: "protected_role", roleId: "system:admin" })
    expect(parseBlocker("exceeds_authority")).toEqual({ reason: "exceeds_authority" })
  })

  test("toggle", () => {
    expect(toggle(["a"], "b", true)).toEqual(["a", "b"])
    expect(toggle(["a", "b"], "a", false)).toEqual(["b"])
    expect(toggle(["a"], "a", true)).toEqual(["a"])
  })
})
