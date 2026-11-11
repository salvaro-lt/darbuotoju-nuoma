# Notes for @digimuza/system-core

Issues found while building this template against `@digimuza/system-core@0.1.0`.
The template works around each one; none needed a change in the package to ship.
Fixes belong in https://github.com/digimuza/system-core (branch, PR, release), never patched from here.

| # | Issue | Workaround in the template | Suggested fix in system-core |
| - | - | - | - |
| 1 | **Fixed in 0.2.0** (DIG-70). `system.requirePermission(ctx, …)` and `system.context(ctx)` take `DbCtx` (`GenericDatabaseReader<GenericDataModel>`). The generated `QueryCtx`/`MutationCtx` of an app with a real schema are **not assignable** to it, so the INTEGRATION.md example fails typecheck outside `mutationGeneric`. | `convex/system.ts` exports typed `requirePermission` / `systemContext` wrappers that cast once. | Make `DbCtx` generic (`<DM extends GenericDataModel>`) or accept `{ db: unknown; auth: Auth }`. Add a typed-schema consumer to `check:pack`. |
| 2 | **Fixed in 0.2.0** (DIG-70). The default `identityFromJwt` reads `identity.emailVerified`. For custom JWT providers (Better Auth, WorkOS with a JWT template, most OIDC setups), Convex passes the `email_verified` claim through raw and leaves `emailVerified` unset. Result: Super bootstrap and invite acceptance fail with `UNAUTHENTICATED` although the email is verified. | `identityFromJwt` in `convex/system.ts` reads both. Tests use the raw claim shape. | Default mapping should fall back to `identity.email_verified`. |
| 3 | `systemTables` defines a `users` table. `@convex-dev/auth`'s `authTables` also needs `users`, so Convex Auth cannot be used. | Not using Convex Auth (first Better Auth, now WorkOS AuthKit). | Optional table-name prefix, or document the conflict. |
| 4 | No query lists a user's roles: `PublicUser` has no `roleIds`, so a "user detail" screen can't show or revoke per-user roles. | Revoke from the role detail (`getRole` → `grantees.userIds`). | `listUserRoles(userId)` or `roleIds` on `PublicUser` (permission-filtered). |
| 5 | The default `SystemConfig` always includes `infisicalSource()`, which throws when the `INFISCAL_*` bootstrap keys are missing. There is no local-dev mode (`infisical run -- pnpm dev` injects plain env vars). | `lib/server-env.ts` and `scripts/deploy-convex.ts` build their own config: env only when the bootstrap is absent, and fail for non-development `APP_ENV`. | e.g. `infisicalSource({ optional: true })`, or skip Infisical when no bootstrap key is set. |
| 6 | `completeSignIn` for an unknown identity without an invite returns `UNAUTHENTICATED` (`invite_required`), not `FORBIDDEN`. Correct per spec maybe, but surprising for UI copy. | Login form treats both as "no access". | Document it in INTEGRATION.md. |
| 7 | "View as role" lived in the app and could not cover system-core's own admin functions. | Removed from the app. | **Done in 0.2.0** (DIG-70): `startRoleView` / `stopRoleView` / `roleViewStatus`, enforced in every decision. |
| 8 | Business modules were app code, copied between client apps. | Finance now comes from the package. | **Done in 0.2.0**: `@digimuza/system-core/finance`; new modules follow the same subpath pattern. |
