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
| `dr-nuoma-pranesimas` | 4 (and any) | `title, text?, lines?: string[], appUrl?` | planner / coordinator (plan changed, car without driver, beds < people…) |

Inactive: `dr-nuoma – Pirkimo sąskaitos į SitePro` (audit quick win: forward
purchase invoices from 3 mailboxes to SitePro). Needs the client's IMAP
credentials and SitePro import address.
