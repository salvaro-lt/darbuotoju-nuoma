import { describe, expect, test } from "vitest"
import { CONVEX_ENV_KEYS, convexEnvSchema, parse } from "./env"

describe("env", () => {
  test("errors name the missing keys and never echo values", () => {
    const secret = "short-secret-value"
    let message = ""
    try {
      parse(convexEnvSchema, { APP_ENV: "production", SITE_URL: "not a url", WORKOS_CLIENT_ID: secret })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain("SITE_URL")
    expect(message).toContain("WORKOS_CLIENT_ID")
    expect(message).not.toContain(secret)
  })

  test("APP_ENV is required", () => {
    expect(() => parse(convexEnvSchema, { SITE_URL: "https://app.test", WORKOS_CLIENT_ID: "client_ABC" })).toThrow(/APP_ENV/)
  })

  test("SUPER_USER_EMAILS is a trimmed, lower-cased list", () => {
    const env = parse(convexEnvSchema, {
      APP_ENV: "staging",
      SITE_URL: "https://app.test",
      WORKOS_CLIENT_ID: "client_ABC",
      SUPER_USER_EMAILS: " Super@Acme.test , ops@acme.test,",
    })
    expect(env.SUPER_USER_EMAILS).toEqual(["super@acme.test", "ops@acme.test"])
  })

  test("predeploy copies exactly the Convex schema keys", () => {
    expect(CONVEX_ENV_KEYS).toEqual(Object.keys(convexEnvSchema.shape))
  })
})
