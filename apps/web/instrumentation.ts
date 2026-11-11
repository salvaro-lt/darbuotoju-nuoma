// Loads configuration (env + Infisical) once at server start, so a missing
// key fails fast in the container logs instead of on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { getServerEnv } = await import("@/lib/server-env")
  try {
    await getServerEnv()
  } catch (e) {
    console.error(`[config] ${e instanceof Error ? e.message : "configuration failed to load"}`)
  }
}
