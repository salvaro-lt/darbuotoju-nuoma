import type { AuthConfig } from "convex/server"

// WorkOS AuthKit access tokens. WORKOS_CLIENT_ID is set on the Convex
// deployment (`pnpm deploy:convex` copies it from Infisical); Convex reads
// this file when the code is pushed, so changing the ID needs a redeploy.
const clientId = process.env.WORKOS_CLIENT_ID

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      // AuthKit session tokens use this issuer (no `aud` claim).
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
} satisfies AuthConfig
