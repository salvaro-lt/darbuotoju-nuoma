"use client"
import { SystemProvider } from "@digimuza/system-core/react"
import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import { api } from "@/convex/_generated/api"

/** Feeds the WorkOS access token to Convex; refreshes it when Convex asks. */
function useConvexAuthFromWorkOS() {
  const { user, loading } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) return null
      try {
        return (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null
      } catch {
        return null
      }
    },
    [user, getAccessToken, refresh],
  )
  return useMemo(() => ({ isLoading: loading, isAuthenticated: !!user, fetchAccessToken }), [loading, user, fetchAccessToken])
}

/**
 * WorkOS session, Convex client with its token, and system-core's live session
 * (current user, visible modules, permissions, flags) for `useCan` / `<Can>`.
 * `convexUrl` comes from the server at runtime (see app/layout.tsx).
 */
export function Providers({
  children,
  convexUrl,
  initialAuth,
}: {
  children: ReactNode
  convexUrl: string
  initialAuth: ComponentProps<typeof AuthKitProvider>["initialAuth"]
}) {
  const [convex] = useState(() => new ConvexReactClient(convexUrl))
  return (
    <AuthKitProvider initialAuth={initialAuth}>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromWorkOS}>
        <SystemProvider session={api.system.session}>{children}</SystemProvider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  )
}
