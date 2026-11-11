"use server"
import { signOut } from "@workos-inc/authkit-nextjs"
import { api } from "@/convex/_generated/api"
import { publicError, systemServer } from "@/lib/system-server"
import { workosUrls } from "@/lib/workos"

/**
 * Links the WorkOS identity to a system user. Idempotent. Unknown identities
 * need a valid invite token or a verified SUPER_USER_EMAILS address.
 */
export async function finishSignIn(inviteToken?: string) {
  const client = await systemServer()
  try {
    const res = await client.mutation(api.system.completeSignIn, {
      operationId: client.operationId,
      ...(inviteToken ? { inviteToken } : {}),
    })
    client.end()
    return { ok: true as const, created: res.created }
  } catch (e) {
    client.end(e)
    return { ok: false as const, ...publicError(e) }
  }
}

/** Ends the WorkOS session and returns to /login (the dashboard's sign-out redirect). */
export async function signOutAction() {
  await signOut({ returnTo: workosUrls().afterSignOut })
}
