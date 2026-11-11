import { defaultIdentity, defineConvexSystem } from "@digimuza/system-core/convex"
import { notificationsHook } from "@digimuza/system-core/notifications"
import type { UserIdentity } from "convex/server"
import { appModules } from "../modules"
import { getConvexEnv } from "../env"
import { sendMail } from "./mail"

/** Fixed provider name, so identities survive an issuer change (e.g. a custom WorkOS auth domain). */
export const AUTH_PROVIDER = "workos"

/**
 * WorkOS access tokens carry `sub` (the WorkOS user ID, stable) but no email by
 * default: the WorkOS JWT template must add `email` and `email_verified`
 * (README → WorkOS). system-core's default mapping reads them, including the
 * raw `email_verified` claim; only the provider name is fixed here.
 */
export const workosIdentity = (identity: UserIdentity) => ({ ...defaultIdentity(identity), provider: AUTH_PROVIDER })

export const system = defineConvexSystem({
  modules: appModules,
  // superUserEmails defaults to process.env.SUPER_USER_EMAILS.
  identityFromJwt: workosIdentity,
  // Modules (finance, roles, …) send notifications through this hook; see convex/notifications.ts.
  notifications: notificationsHook(),
  inviteUrl: (token) => `${getConvexEnv().SITE_URL}/invite?token=${encodeURIComponent(token)}`,
  inviteDelivery: {
    deliver: async ({ email, url }) => {
      await sendMail({
        to: email,
        subject: "Kvietimas prisijungti",
        text: `Jus pakvietė prisijungti prie sistemos.\n\nPriimti kvietimą: ${url}\n\nNuoroda vienkartinė.`,
      })
    },
  },
})

// Public and internal system functions. The names are the integration
// contract (see INTEGRATION.md in @digimuza/system-core); export all of them.
export const {
  session,
  completeSignIn,
  registerSystem,
  listModules,
  setModuleEnabled,
  listPermissions,
  explainDecision,
  getUser,
  findUserByIdentity,
  listUsers,
  suspendUser,
  activateUser,
  getMyProfile,
  updateMyProfile,
  listRoles,
  getRole,
  listSubroles,
  createRole,
  copyRole,
  updateRole,
  archiveRole,
  createSubrole,
  copySubrole,
  previewSubroleChange,
  updateSubrole,
  archiveSubrole,
  assignRoles,
  revokeRole,
  setDelegationScope,
  listInvites,
  getInvite,
  revokeInvite,
  createInvite,
  resendInvite,
  _createInvite,
  _resendInvite,
  _recordInviteDelivery,
  listMyApiKeys,
  setApiKeyRoles,
  revokeApiKey,
  createApiKey,
  rotateApiKey,
  _createApiKey,
  _rotateApiKey,
  listFeatureFlags,
  setFeatureFlag,
  resetFeatureFlag,
  listAudit,
  listAuditFacets,
  recordAuditExport,
  roleViewStatus,
  startRoleView,
  stopRoleView,
} = system.functions

