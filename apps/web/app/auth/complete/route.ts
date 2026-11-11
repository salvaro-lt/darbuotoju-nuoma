import { withAuth } from "@workos-inc/authkit-nextjs"
import { decodeJwt } from "jose"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { finishSignIn } from "@/app/login/actions"
import { INVITE_COOKIE } from "@/lib/workos"

/**
 * After WorkOS: link the WorkOS identity to a system user (system:completeSignIn).
 * Unknown identities need the invite token from /sign-in, or a verified
 * SUPER_USER_EMAILS address. Idempotent, so returning users pass straight through.
 */
export async function GET() {
  const { user, accessToken } = await withAuth()
  if (!user || !accessToken) redirect("/login")

  // Without the WorkOS JWT template the token has no email: say so instead of
  // a generic "no access", because no user could ever get in.
  const claims = decodeJwt(accessToken)
  if (typeof claims.email !== "string" || typeof claims.email_verified !== "boolean") redirect("/login?state=jwt-template")

  const jar = await cookies()
  const invite = jar.get(INVITE_COOKIE)?.value
  if (invite) jar.delete({ name: INVITE_COOKIE, path: "/auth/complete" })

  const res = await finishSignIn(invite)
  redirect(res.ok ? "/app" : `/login?state=no-access${res.operationId ? `&op=${res.operationId}` : ""}`)
}
