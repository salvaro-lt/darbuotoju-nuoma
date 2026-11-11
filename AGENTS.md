# system-template (pnpm monorepo)

| Path | What |
| - | - |
| `apps/web` | The client app: Next.js 16 + Convex + `@digimuza/system-core`. Read `apps/web/AGENTS.md` before changing Next.js code. |
| `packages/crm` | `@digimuza/crm`: the metadata-driven CRM business module (objects, fields, records, views, relations, notes). Backend only; its UI lives in `apps/web/app/app/crm`. |
| `packages/documents` | `@digimuza/documents`: document archive with labels and matching rules (Paperless-ngx style) and e-signing with signed PDFs (DocuSeal style). Backend only; UI in `apps/web/app/app/documents` and `apps/web/app/sign`. |
| `scripts/` | Repo-level release tooling (release cut, Coolify deploy, Linear transitions). App scripts live in `apps/web/scripts`. |

- Package manager: pnpm workspaces. Run root scripts (`pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`) from the repo root; they fan out with `pnpm -r` or `--filter @app/web`.
- Add a dependency to the package that imports it: `pnpm --filter @app/web add <pkg>`.
- Workspace packages ship TypeScript source (`exports` point at `src/*.ts`). Next compiles them through `transpilePackages`; Convex bundles them itself.
- Authentication is WorkOS AuthKit only (see the `workos` skill). Modules never handle sign-in; they guard with `system.requirePermission`.
