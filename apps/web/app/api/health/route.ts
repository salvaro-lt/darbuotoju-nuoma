import { getServerEnv } from "@/lib/server-env"

export const dynamic = "force-dynamic"

// Baked into the image at build time (Dockerfile ARGs). The same values on
// staging and production, which is how the release workflow proves that
// production runs the image staging tested.
const version = process.env.APP_VERSION ?? "dev"
const revision = process.env.GIT_SHA ?? "dev"

/**
 * Readiness probe for Coolify and the deploy workflow. 503 until configuration
 * loaded and validated, naming only the missing keys, never values.
 */
export async function GET() {
  try {
    const env = await getServerEnv()
    return Response.json({ status: "ok", appEnv: env.APP_ENV, version, revision })
  } catch (e) {
    return Response.json({ status: "unavailable", version, revision, error: e instanceof Error ? e.message : "config error" }, { status: 503 })
  }
}
