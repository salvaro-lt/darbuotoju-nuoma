// Read model for the role/subrole editor (app/app/admin/users).
//
// system-core 0.3.0 exposes role editing, but the browser cannot learn *why* a
// change would be refused: error reasons stay on the server (only the code is
// public). It also lists subroles without their permissions. This query
// answers both, read-only, with core's own checks (`checkGrant`,
// `entitlements`, …) so the UI shows the same locks the mutations enforce.
// Candidate for system-core (e.g. `listSubroles` with permissions + a
// `roleControl` query); until then every client app copies this file.
import { checkGrant, decide, entitlements, heldRoleIds, isSuperActor, permissionsOfSubrole, PROFILE_ROLE_ID, toConvexError, P } from "@digimuza/system-core/convex"
import { query } from "./_generated/server"
import { system } from "./system"

/** Why the actor cannot do something to a role (core's forbidden reasons), or null if allowed. */
type Lock = string | null

export interface RoleAccess {
  /** updateRole (name, description, subroles). */
  edit: Lock
  /** archiveRole. */
  archive: Lock
  /** setDelegationScope on this role. */
  delegation: Lock
  /** Whether the actor may grant this role (assign, invite, put it in a delegation scope). */
  grant: Lock
  /** The actor holds this role. */
  held: boolean
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const { sys, actor } = await system.requirePermission(ctx, P.rolesRead)
    try {
      const human = actor.kind === "user" ? actor : null
      const isSuper = await isSuperActor(sys, actor)
      const held = new Set(human ? await heldRoleIds(sys, { userId: human.userId }) : [])
      const ent = human && !isSuper ? await entitlements(sys, human.userId) : null

      const subrolePermissions: Record<string, string[]> = {}
      for (const s of await sys.store.all("subroles")) {
        if (!s.archived) subrolePermissions[s.key] = [...(await permissionsOfSubrole(sys, s.key))].sort()
      }

      // Mirrors roles.ts: updateRole → assertControls; archiveRole → protected + assertControls(allowHeld);
      // setDelegationScope → assertControls (Super skips it).
      const roles: Record<string, RoleAccess> = {}
      for (const role of await sys.store.all("roles")) {
        if (role.archived) continue
        const isHeld = held.has(role.key)
        if (!human) {
          const lock = "human_session_required"
          roles[role.key] = { edit: lock, archive: lock, delegation: lock, grant: lock, held: isHeld }
          continue
        }
        const grantCheck = await checkGrant(sys, human, role.key)
        const grant = grantCheck.ok ? null : grantCheck.reason
        const control = (allowHeld: boolean): Lock => {
          if (isSuper) return null
          if (role.protected) return "protected_role"
          if (!allowHeld && isHeld) return "own_authority"
          return grant
        }
        roles[role.key] = {
          edit: role.key === PROFILE_ROLE_ID ? "implicit_role" : control(false),
          archive: role.protected ? "protected_role" : control(true),
          delegation: control(false),
          grant,
          held: isHeld,
        }
      }

      // Role badges on the users list; only for viewers allowed to see users.
      let userRoles: Record<string, string[]> | null = null
      if ((await decide(sys, actor, P.usersRead)).allowed) {
        userRoles = {}
        for (const ur of await sys.store.all("userRoles")) {
          if (!roles[ur.roleId]) continue // archived
          ;(userRoles[ur.userId] ??= []).push(ur.roleId)
        }
      }

      return {
        isSuper,
        /** Permissions the actor may put into roles/subroles; null = no limit (Super). */
        entitlements: ent ? [...ent].sort() : null,
        subrolePermissions,
        roles,
        userRoles,
      }
    } catch (e) {
      throw toConvexError(e, sys.operationId)
    }
  },
})
