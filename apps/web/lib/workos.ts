import "server-only"
import { getPublicEnv } from "@/env"

// AuthKit would take its redirect URI from NEXT_PUBLIC_WORKOS_REDIRECT_URI, which
// Next.js inlines at build time. One image runs on staging and production, so
// every AuthKit call gets these URLs explicitly, derived from runtime SITE_URL.
// Register them in the WorkOS dashboard (README → WorkOS).
export const workosUrls = () => {
  const site = getPublicEnv().SITE_URL.replace(/\/+$/, "")
  return {
    site,
    /** Redirect URI. */
    callback: `${site}/callback`,
    /** Initiate login URI. */
    signIn: `${site}/sign-in`,
    /** Sign-out redirect. */
    afterSignOut: `${site}/login`,
  }
}

/** Short-lived cookie that carries an invite token across the WorkOS round trip. */
export const INVITE_COOKIE = "invite_token"
