import { getSignInUrl } from "@workos-inc/authkit-nextjs"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"
import { INVITE_COOKIE, workosUrls } from "@/lib/workos"

/**
 * Starts the WorkOS sign-in (also the dashboard's "Initiate login URI").
 * `?invite=<token>` is kept in an httpOnly cookie, not sent to WorkOS, and
 * redeemed by /auth/complete after the user has proven their email.
 */
export async function GET(request: NextRequest) {
  const invite = request.nextUrl.searchParams.get("invite")
  if (invite) {
    ;(await cookies()).set(INVITE_COOKIE, invite, {
      httpOnly: true,
      sameSite: "lax",
      secure: workosUrls().site.startsWith("https://"),
      path: "/auth/complete",
      maxAge: 30 * 60,
    })
  }
  redirect(await getSignInUrl({ redirectUri: workosUrls().callback }))
}
