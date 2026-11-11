import { handleAuth } from "@workos-inc/authkit-nextjs"
import type { NextRequest } from "next/server"
import { workosUrls } from "@/lib/workos"

// WorkOS redirect URI. AuthKit exchanges the code, sets the session cookie, then
// sends the browser to /auth/complete, which links the system account.
export async function GET(request: NextRequest) {
  const { site } = workosUrls()
  return handleAuth({
    returnPathname: "/auth/complete",
    baseURL: site,
    onError: () => Response.redirect(`${site}/login?state=error`, 302),
  })(request)
}
