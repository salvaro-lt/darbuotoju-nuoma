import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // convex-test needs the edge runtime to match Convex's environment.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["**/*.test.ts"],
    // Convex deployment env used by convex/*.test.ts. Test values only.
    env: {
      APP_ENV: "development",
      SITE_URL: "https://app.test",
      WORKOS_CLIENT_ID: "client_TEST123",
      SUPER_USER_EMAILS: "super@acme.test",
      RESEND_API_KEY: "test-resend-key",
    },
    exclude: ["node_modules/**", ".next/**"],
  },
})
