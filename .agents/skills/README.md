# Agent skills

Copied from [`ai-setup`](../../../ai-setup) (`.agents/skills/`), the shared skill set for AI-assisted development
with T3 Code. Claude Code reads them through the `.claude/skills` symlink.

## Our stack

| Skill | For |
| --- | --- |
| `nextjs` | the main framework: Next.js 16 App Router rules for apps built from system-template |
| `convex` | backend: functions, schema, env, deploys, tests, system-core patterns; backend logic written for reuse |
| `business-module` | designing a reusable business module (shared logic goes to `@digimuza/system-core`) |
| `workos` | AuthKit sign-in and the WorkOS CLI |
| `infisical` | secrets via the `infisical` CLI (self-hosted instance) |
| `coolify` | hosting and deploys on the Hetzner server |
| `linear` | work tracking via the `linear` CLI (team DIG) |

## Workflow skills and credits

- **[t3dotgg/tstack](https://github.com/t3dotgg/tstack)** by Theo Browne (MIT): `babysit-pr`, `council`, `file-pr`,
  `full-send`, `full-stop`, `leaving-pr-comments`, `modernize`, `sol-loop`, `takeover`
- **[mattpocock/skills](https://github.com/mattpocock/skills/tree/main)** by Matt Pocock (MIT): `code-review`,
  `codebase-design`, `diagnosing-bugs`, `grill-me`, `grilling`, `retro`, `to-spec`, `wizard`
- `sdlc` and the stack skills above were written for digimuza. `sdlc` and `file-pr` use Linear issue keys (DIG-123).

## Keeping in sync with ai-setup

`ai-setup` is the source. After changing a skill there:
`rsync -a --exclude .DS_Store --exclude README.md ../ai-setup/.agents/skills/ .agents/skills/`
