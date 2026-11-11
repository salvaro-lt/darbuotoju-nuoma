import "server-only"
import { withAuth } from "@workos-inc/authkit-nextjs"

/** WorkOS access token of the current request (Convex validates it), or undefined. */
export async function getToken(): Promise<string | undefined> {
  const { accessToken } = await withAuth()
  return accessToken ?? undefined
}

export async function isAuthenticated(): Promise<boolean> {
  return !!(await withAuth()).user
}
