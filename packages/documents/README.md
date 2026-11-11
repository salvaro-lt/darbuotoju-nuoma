# @digimuza/documents

Business module `documents` (kind `business`, registers disabled; Super enables it).

**Archive** (Paperless-ngx style): upload PDFs and images, recognised text, archive serial numbers (ASN), tags (with inbox tags), correspondents, document types, custom fields, full-text search, filters, saved views, notes, trash, duplicate detection by SHA-256.
Matching rules per label: `none`, `any`, `all`, `literal`, `regex`, `fuzzy`, `auto` (AI picks from labels set to auto).

**Signing** (DocuSeal style): PDF template → fields per signer role (signature, initials, text, name, email, date, checkbox) → submission with one link per signer (in order or in parallel, expiry) → public signing page without an account → signed PDF with a certificate page (signers, times, devices, original SHA-256), filed into the archive. Simple electronic signature (eIDAS art. 3(10)); not a qualified signature.

| | |
| - | - |
| Data owner | the client company (all tables `doc*`, files in Convex storage) |
| Permissions | `documents:document:{read,create,update,delete}`, `documents:label:manage`, `documents:signing:{read,send}`, `documents:template:manage` |
| Subroles | `documents:viewer`, `documents:editor`, `documents:admin` |
| Flags | `documents:signing` (default on), `documents:ai` (default on: text recognition of scans + `auto` labels) |
| Config | `defineDocuments(system, { signingUrl, deliver, font, aiModel })`; env `DOCUMENTS_AI_MODEL` / `AI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` |
| AI tools | `documents.search_documents`, `documents.list_submissions` (read-only) |

Text: the browser reads the PDF text layer (pdf.js) and uploads a thumbnail and, for scans, page images; a vision model recognises the text in the background when `documents:ai` is on and the AI is configured.
Public functions without a session: `getSigningSession`, `markSigningOpened`, `submitSignature`, `declineSignature` (the link token proves the signer; only its SHA-256 is stored).

Success: an editor uploads `telia_2026-10.pdf`; the "Telia" correspondent (rule `any: telia`) and inbox tag are applied; it is found by searching `SF-1024`.
Denial: a `documents:viewer` calls `generateUploadUrl` → `FORBIDDEN`; with the module off every call → `FORBIDDEN`.

Tests: `pnpm --filter @digimuza/documents test` (rules, fields, PDF) and `apps/web/convex/documents.test.ts` (access, archive, full signing flow).
