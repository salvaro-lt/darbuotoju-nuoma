# n8n mail automations (dr-nuoma)

Outgoing mail runs through n8n (https://n8n.digimuza.ai) → Resend. The app
(Convex, also the local backend) **pushes** events to n8n webhooks, so it works
from localhost; n8n never calls back into the app.

Deploy / update (idempotent; values come from Infisical, never typed):

```sh
export INFISICAL_DOMAIN=https://infiscal.digimuza.ai/api
infisical secrets-manager run --projectId f517320f-30ea-46c5-907e-c05273b97b44 --env dev --path / -- python3 -I n8n/deploy.py
```

## Calling a webhook from Convex

`POST ${N8N_URL}/webhook/<path>` with headers `Content-Type: application/json` and
`X-Webhook-Secret: ${N8N_WEBHOOK_SECRET}` (both are Convex env vars). Do it from an
`internalAction` (fetch), scheduled from the mutation that triggers it. Response:
`{"id": "<resend id>"}`.

Every body accepts:

| Field | |
| - | - |
| `to` | recipient(s), string or array |
| `redirectTo` | **set it whenever `APP_ENV !== "production"`** (value: first of `SUPER_USER_EMAILS`). The mail goes there; the subject shows the original recipient. Demo data has fake addresses. |
| `replyTo` | optional |
| `language` | `lt` (default) or `en` (client-facing mails) |

## Webhooks

| Path | Audit place | Body (besides the common fields) | Who gets it |
| - | - | - | - |
| `dr-nuoma-dokumentu-galiojimas` | 5 | `items: [{worker, document, expiresAt, daysLeft, currentProject?}]`, `appUrl?` | planner (daily digest; 60 and 30 days, expired) |
| `dr-nuoma-tabelio-priminimas` | 2 | `projectName, period, contactName?, workerCount?, senderName?` | client contact |
| `dr-nuoma-mokejimo-priminimas` | 3 | `invoiceNumber, amountCents, currency?, dueDate, daysOverdue, stage (1 polite, 2 firmer), contactName?, senderName?` | client contact |
| `dr-nuoma-komandos-pasiulymas` | 1 | `clientName, request {…}, team: [{name, trade, isDriver?, certificates?[]}], missing?: string[]` → AI (9Router `fast`) writes the client answer draft | **project manager** (not the client: client communication stays human) |
| `dr-nuoma-dokumentu-paketas` | DIG-113 | `subject, html, text, attachments: [{filename, url}], linkUrl` (the app renders the mail: team, document validity, "Trūksta: …"; Resend fetches each `url` as the attachment; big packages have no attachments, only the ZIP link) | client contacts (package page or `staffing-compliance.send_package`) |
| `dr-nuoma-pranesimas` | 4 (and any) | `title, text?, lines?: string[], appUrl?` | planner / coordinator (plan changed, car without driver, beds < people…) |

Inactive: `dr-nuoma – Pirkimo sąskaitos į SitePro` (audit quick win: forward
purchase invoices from 3 mailboxes to SitePro). Needs the client's IMAP
credentials and SitePro import address.

## The `n8n` module (app ↔ n8n, ported from DIG-96)

Besides the mail workflows above, the app has an `n8n` business module
(`apps/web/modules/n8n.ts`, disabled until a Super enables it; subroles
`n8n:viewer`, `n8n:admin`). It only sees workflows tagged `dr-nuoma`
(`N8N_TAG`); the mail workflows above are untagged, so the app never lists or
changes them.

- **Email → n8n.** A Gavimas inbox can be linked to a tagged workflow with a
  POST Webhook trigger (Gavimas → inbox → "Kas skaito šią dėžutę", or
  `ingest.create_inbox` with `links: [{to: "n8n", id}]`). Every received email
  is POSTed as `{event: "email.received", deliveryId, email: {…}}` with
  `X-Webhook-Secret: ${N8N_WEBHOOK_SECRET}` (same header auth as above),
  `X-Webhook-Signature: sha256=<HMAC of the body>` and `X-Webhook-Delivery`;
  retried after 1, 4 and 16 min (`convex/n8n.ts` `_forward`).
- **Assistant tools.** `n8n.*` (search, get, executions, node catalogue; create,
  update, activate, execute with approval, queued in `n8nOps` and drained by a
  10 s cron) and `mail.reply_to_email` (`ingest:inbox:manage`; outbox drained by
  `replies:_drain`, at most 1 reply per 2 min / 3 per hour per recipient).
- **Tool gateway for n8n.** `/api/v1/mcp` (MCP, stateless) and
  `/api/v1/tools[/<tool>]` run the assistant's tools for an agent key
  (`Authorization: Bearer dsk_…`), capped by the key owner's permissions, writes
  without an approval card. The key: `npx convex run n8nSetup:_issueAgentKey
  '{"name":"n8n"}'` (role "n8n agentas": every business subrole except `n8n:*`).
- **Setup.** `pnpm --filter @app/web n8n:setup [--dry-run] [--issue-key]
  [--activate] [--link-inbox=<address>]` (through `infisical run`): tag
  `dr-nuoma`, credentials `dr-nuoma – API` (agent key) plus `dr-nuoma – 9Router`
  / `dr-nuoma – Webhook` (reused from `deploy.py` when `.credential-ids.json` or
  `N8N_CREDENTIAL_IDS` knows them), and the read-only template workflow
  `dr-nuoma – Laiškas → AI santrauka` (created inactive).

Convex env: `N8N_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_SECRET`, optional
`N8N_MCP_URL`, `N8N_MCP_TOKEN` (`pnpm deploy:convex` copies them). Infisical
only: `N8N_AGENT_API_KEY`. Without `N8N_URL` / `N8N_API_KEY` the module stays
idle (crons skip, deliveries are recorded as failed).
