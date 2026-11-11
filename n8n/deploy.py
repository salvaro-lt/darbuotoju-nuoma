#!/usr/bin/env python3
"""Deploy the dr-nuoma mail automations to n8n (https://n8n.digimuza.ai).

Run through Infisical so no value is ever typed or printed:

    infisical secrets-manager run --projectId <dr-nuoma> --env dev --path / -- python3 -I n8n/deploy.py

Needs: N8N_URL, N8N_API_KEY, N8N_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM,
OPENAI_API_KEY, OPENAI_BASE_URL. Optional N8N_CREDENTIAL_IDS (JSON, written
back to Infisical by hand after the first run) to reuse credentials.

Idempotent for workflows (matched by name, updated in place). Every workflow
is a webhook (header `X-Webhook-Secret`) → build mail → Resend → reply with
the Resend id. Contract of each webhook: see n8n/README.md.
"""
import json
import os
import sys
import urllib.error
import urllib.request

N8N = os.environ["N8N_URL"].rstrip("/")
KEY = os.environ["N8N_API_KEY"]
PREFIX = "dr-nuoma"


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{N8N}/api/v1{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-N8N-API-KEY": KEY, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"n8n {method} {path} → HTTP {e.code}: {e.read().decode()[:400]}")


# ---------- credentials (created once) ----------
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".credential-ids.json")
cred_ids = json.loads(os.environ.get("N8N_CREDENTIAL_IDS") or "{}")
if os.path.exists(STATE):
    cred_ids.update(json.load(open(STATE)))


def credential(key, name, ctype, data):
    if key not in cred_ids:
        cred_ids[key] = api("POST", "/credentials", {"name": name, "type": ctype, "data": data})["id"]
        json.dump(cred_ids, open(STATE, "w"))
        print(f"created credential {name}")
    return {"id": cred_ids[key], "name": name}


webhook_cred = credential(
    "webhook", f"{PREFIX} – Webhook", "httpHeaderAuth",
    {"name": "X-Webhook-Secret", "value": os.environ["N8N_WEBHOOK_SECRET"]},
)
resend_cred = credential(
    "resend", f"{PREFIX} – Resend", "httpHeaderAuth",
    {"name": "Authorization", "value": f"Bearer {os.environ['RESEND_API_KEY']}"},
)
ai_cred = credential(
    "ai", f"{PREFIX} – 9Router", "openAiApi",
    {"apiKey": os.environ["OPENAI_API_KEY"], "url": os.environ["OPENAI_BASE_URL"], "header": False},
)

MAIL_FROM = os.environ["MAIL_FROM"]

# Shared JS: layout + demo redirect. In non-production the app sends
# `redirectTo`: the mail goes there, the original recipient is shown in the subject.
LAYOUT_JS = r"""
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const layout = (title, inner) => `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1d2b26">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid #dfe5e2">
<tr><td style="background:#2f5d50;color:#fff;padding:16px 24px;font-size:16px;font-weight:bold;border-radius:8px 8px 0 0">Darbuotojų nuoma</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 16px;font-size:18px">${esc(title)}</h2>${inner}</td></tr>
<tr><td style="padding:12px 24px;color:#6b7a74;font-size:12px;border-top:1px solid #eef1f0">Automatinis pranešimas iš darbuotojų nuomos sistemos.</td></tr>
</table></td></tr></table></body></html>`;
const table = (head, rows) => `<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<tr>${head.map((h) => `<th align="left" style="border-bottom:2px solid #dfe5e2">${esc(h)}</th>`).join('')}</tr>
${rows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #eef1f0">${c}</td>`).join('')}</tr>`).join('')}</table>`;
const send = (b, to, subject, html) => {
  const list = [].concat(to || []).filter(Boolean);
  const redirect = b.redirectTo ? [].concat(b.redirectTo) : null;
  return [{ json: {
    from: MAIL_FROM_VALUE,
    to: redirect ?? list,
    subject: redirect ? `[DEMO → ${list.join(', ')}] ${subject}` : subject,
    html,
    reply_to: b.replyTo || undefined,
  } }];
};
""".replace("MAIL_FROM_VALUE", json.dumps(MAIL_FROM))


def webhook_node(path, name="Webhook"):
    return {
        "name": name, "type": "n8n-nodes-base.webhook", "typeVersion": 2.1, "position": [0, 0],
        "webhookId": f"{PREFIX}-{path}",
        "parameters": {"httpMethod": "POST", "path": f"{PREFIX}-{path}", "authentication": "headerAuth",
                       "responseMode": "lastNode", "options": {}},
        "credentials": {"httpHeaderAuth": webhook_cred},
    }


def code_node(name, js, x):
    return {"name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, 0],
            "parameters": {"jsCode": LAYOUT_JS + "\nconst b = $input.first().json.body ?? $input.first().json;\n" + js}}


def resend_node(x):
    return {
        "name": "Resend", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, 0],
        "parameters": {
            "method": "POST", "url": "https://api.resend.com/emails",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
            "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}", "options": {},
        },
        "credentials": {"httpHeaderAuth": resend_cred},
    }


def chain(*names):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}


def mail_workflow(title, path, js):
    nodes = [webhook_node(path), code_node("Laiškas", js, 260), resend_node(520)]
    return {"name": f"{PREFIX} – {title}", "nodes": nodes, "connections": chain("Webhook", "Laiškas", "Resend")}


workflows = []

# 1. Certificates / permits expiring in 60 and 30 days → planner digest (audit, place 5).
workflows.append(mail_workflow("Baigiantys galioti dokumentai", "dokumentu-galiojimas", r"""
const items = b.items ?? [];
const badge = (d) => d < 0 ? '<b style="color:#b42318">pasibaigęs</b>' : d <= 30 ? `<b style="color:#b54708">${d} d.</b>` : `${d} d.`;
const rows = items.map((i) => [esc(i.worker), esc(i.document), esc(i.expiresAt), badge(i.daysLeft), esc(i.currentProject ?? '–')]);
const html = layout(`Baigiantys galioti dokumentai: ${items.length}`,
  `<p>Šių darbuotojų dokumentai baigia galioti per 60 dienų arba jau nebegalioja. Užsakykite naujus, kol darbuotojas dar gali dirbti.</p>`
  + table(['Darbuotojas', 'Dokumentas', 'Galioja iki', 'Liko', 'Dabar dirba'], rows)
  + (b.appUrl ? `<p style="margin-top:16px"><a href="${esc(b.appUrl)}" style="color:#2f5d50">Atidaryti sistemoje</a></p>` : ''));
return send(b, b.to, `Baigiantys galioti dokumentai (${items.length})`, html);
"""))

# 2. Client timesheet is late → polite reminder to the client contact (audit, place 2).
workflows.append(mail_workflow("Vėluojantis kliento tabelis", "tabelio-priminimas", r"""
const en = b.language === 'en';
const subject = en ? `Timesheet reminder: ${b.projectName}, ${b.period}` : `Priminimas dėl tabelio: ${b.projectName}, ${b.period}`;
const body = en
  ? `<p>Dear ${esc(b.contactName || 'colleague')},</p><p>we have not yet received the timesheet for <b>${esc(b.projectName)}</b> for the period <b>${esc(b.period)}</b> (${esc(b.workerCount ?? '')} workers). Could you please send it at your earliest convenience so we can reconcile the hours?</p><p>Thank you,<br>${esc(b.senderName || 'Project manager')}</p>`
  : `<p>Laba diena${b.contactName ? ', ' + esc(b.contactName) : ''},</p><p>dar negavome projekto <b>${esc(b.projectName)}</b> tabelio už laikotarpį <b>${esc(b.period)}</b> (${esc(b.workerCount ?? '')} darbuotojų). Gal galėtumėte jį atsiųsti, kad sutikrintume valandas?</p><p>Ačiū,<br>${esc(b.senderName || 'Projektų vadovas')}</p>`;
return send(b, b.to, subject, layout(subject, body));
"""))

# 3. Overdue payment → reminder by agreed schedule (stage 1 polite, 2 firmer) (audit, place 3).
workflows.append(mail_workflow("Vėluojantis mokėjimas", "mokejimo-priminimas", r"""
const en = b.language === 'en';
const firm = (b.stage ?? 1) >= 2;
const amount = `${(Number(b.amountCents ?? 0) / 100).toLocaleString('lt-LT', {minimumFractionDigits: 2})} ${b.currency || 'EUR'}`;
const subject = en ? `Payment reminder: invoice ${b.invoiceNumber}` : `Priminimas dėl apmokėjimo: sąskaita ${b.invoiceNumber}`;
const body = en
  ? `<p>Dear ${esc(b.contactName || 'colleague')},</p><p>${firm ? 'This is a second reminder that' : 'A friendly reminder that'} invoice <b>${esc(b.invoiceNumber)}</b> of <b>${amount}</b> was due on <b>${esc(b.dueDate)}</b> (${esc(b.daysOverdue)} days ago). ${firm ? 'Please let us know when we can expect the payment.' : 'If it has already been paid, please disregard this message.'}</p><p>Kind regards,<br>${esc(b.senderName || 'Accounts')}</p>`
  : `<p>Laba diena${b.contactName ? ', ' + esc(b.contactName) : ''},</p><p>${firm ? 'Pakartotinai primename, kad' : 'Draugiškai primename, kad'} sąskaitos <b>${esc(b.invoiceNumber)}</b> suma <b>${amount}</b> turėjo būti apmokėta iki <b>${esc(b.dueDate)}</b> (prieš ${esc(b.daysOverdue)} d.). ${firm ? 'Prašome informuoti, kada galime tikėtis apmokėjimo.' : 'Jei jau apmokėjote, šio laiško nepaisykite.'}</p><p>Pagarbiai,<br>${esc(b.senderName || 'Buhalterija')}</p>`;
return send(b, b.to, subject, layout(subject, body));
"""))

# 4. Team proposal: AI drafts the answer to the client, mail goes to the PROJECT MANAGER
#    (client communication stays human, audit section 2) (audit, place 1).
proposal_prompt = r"""=Tu esi darbuotojų nuomos įmonės projektų vadovo asistentas. Parašyk trumpą, dalykišką atsakymo klientui juodraštį {{ $json.body.language === 'en' ? 'anglų' : 'lietuvių' }} kalba.
Klientas: {{ $json.body.clientName }}
Poreikis: {{ JSON.stringify($json.body.request) }}
Siūloma komanda: {{ JSON.stringify($json.body.team) }}
Ko trūksta: {{ JSON.stringify($json.body.missing ?? []) }}
Taisyklės: nepažadėk to, ko nėra; trūkumus įvardink kaip „derinama“; nenurodyk kainų; pabaigoje parašyk, kad dokumentų paketas pridedamas. Grąžink tik laiško tekstą be temos."""
proposal_js = r"""
const req = $('Webhook').first().json.body;
const draft = $input.first().json.text ?? '';
const rows = (req.team ?? []).map((m) => [esc(m.name), esc(m.trade), m.isDriver ? 'taip' : '', esc((m.certificates ?? []).join(', '))]);
const missing = (req.missing ?? []).map((m) => `<li>${esc(m)}</li>`).join('');
const html = layout(`Komandos pasiūlymas: ${req.clientName}`,
  `<p>DI paruošė atsakymo klientui juodraštį. Peržiūrėkite, pataisykite ir išsiųskite klientui patys.</p>`
  + `<h3 style="font-size:15px">Komanda</h3>` + table(['Darbuotojas', 'Specialybė', 'Vairuoja', 'Sertifikatai'], rows)
  + (missing ? `<h3 style="font-size:15px;color:#b54708">Trūksta</h3><ul>${missing}</ul>` : '')
  + `<h3 style="font-size:15px">Atsakymo juodraštis</h3><div style="white-space:pre-wrap;background:#f4f6f5;padding:12px;border-radius:6px;font-size:13px">${esc(draft)}</div>`);
return send(req, req.to, `Komandos pasiūlymo juodraštis: ${req.clientName}`, html);
"""
workflows.append({
    "name": f"{PREFIX} – Komandos pasiūlymo juodraštis",
    "nodes": [
        webhook_node("komandos-pasiulymas"),
        {"name": "DI juodraštis", "type": "@n8n/n8n-nodes-langchain.chainLlm", "typeVersion": 1.7, "position": [260, 0],
         "parameters": {"promptType": "define", "text": proposal_prompt}},
        {"name": "9Router modelis", "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi", "typeVersion": 1.3, "position": [260, 200],
         "parameters": {"model": {"__rl": True, "mode": "id", "value": "fast"}, "responsesApiEnabled": False, "options": {"temperature": 0.3}},
         "credentials": {"openAiApi": ai_cred}},
        code_node("Laiškas", proposal_js, 520),
        resend_node(780),
    ],
    "connections": {
        **chain("Webhook", "DI juodraštis", "Laiškas", "Resend"),
        "9Router modelis": {"ai_languageModel": [[{"node": "DI juodraštis", "type": "ai_languageModel", "index": 0}]]},
    },
})

# 5. Generic notification (planner/coordinator alerts: plan changed, no driver in a car, beds < people…).
workflows.append(mail_workflow("Pranešimas komandai", "pranesimas", r"""
const lines = (b.lines ?? []).map((l) => `<li>${esc(l)}</li>`).join('');
const html = layout(b.title || 'Pranešimas', `${b.text ? `<p>${esc(b.text)}</p>` : ''}${lines ? `<ul>${lines}</ul>` : ''}`
  + (b.appUrl ? `<p><a href="${esc(b.appUrl)}" style="color:#2f5d50">Atidaryti sistemoje</a></p>` : ''));
return send(b, b.to, b.title || 'Pranešimas', html);
"""))

# 7. Client document package (DIG-113): the app builds subject + HTML (team, document
#    validity, "Trūksta: …") and sends the certificate scans as URLs; Resend fetches
#    each `path` itself. Big packages come without attachments, with a ZIP link in the body.
workflows.append(mail_workflow("Dokumentų paketas klientui", "dokumentu-paketas", r"""
const out = send(b, b.to, b.subject || 'Darbuotojų dokumentai', layout(b.subject || 'Darbuotojų dokumentai', b.html || `<pre>${esc(b.text)}</pre>`));
const files = (b.attachments ?? []).filter((a) => a && a.url && a.filename).slice(0, 40);
if (files.length) out[0].json.attachments = files.map((a) => ({ filename: a.filename, path: a.url }));
if (b.text) out[0].json.text = b.text;
return out;
"""))

# 6. Quick win from the audit: purchase invoices from 3 mailboxes → SitePro address.
#    Inactive: needs the client's mailbox (IMAP) credentials and the SitePro address.
workflows.append({
    "name": f"{PREFIX} – Pirkimo sąskaitos į SitePro (reikia pašto prisijungimo)",
    "nodes": [
        {"name": "Pašto dėžutė (IMAP)", "type": "n8n-nodes-base.emailReadImap", "typeVersion": 2, "position": [0, 0],
         "parameters": {"mailbox": "INBOX", "postProcessAction": "read", "format": "resolved", "options": {"customEmailConfig": '["UNSEEN"]'}}},
        {"name": "Ar sąskaita?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [260, 0],
         "parameters": {"conditions": {"options": {"caseSensitive": False, "typeValidation": "loose"}, "combinator": "or", "conditions": [
             {"leftValue": "={{ $json.subject }}", "rightValue": "sąskait", "operator": {"type": "string", "operation": "contains"}},
             {"leftValue": "={{ $json.subject }}", "rightValue": "invoice", "operator": {"type": "string", "operation": "contains"}},
             {"leftValue": "={{ $json.subject }}", "rightValue": "faktūr", "operator": {"type": "string", "operation": "contains"}},
         ]}, "options": {}}},
        {"name": "Persiųsti į SitePro", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [520, 0],
         "parameters": {"jsCode": "// TODO: set the SitePro import address and send through Resend with attachments.\nreturn $input.all();"}},
    ],
    "connections": {
        "Pašto dėžutė (IMAP)": {"main": [[{"node": "Ar sąskaita?", "type": "main", "index": 0}]]},
        "Ar sąskaita?": {"main": [[{"node": "Persiųsti į SitePro", "type": "main", "index": 0}], []]},
    },
    "inactive": True,
})

# ---------- upsert ----------
existing = {w["name"]: w for w in api("GET", "/workflows?limit=250").get("data", [])}
for wf in workflows:
    inactive = wf.pop("inactive", False)
    body = {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"], "settings": {"executionOrder": "v1"}}
    if wf["name"] in existing:
        wid = existing[wf["name"]]["id"]
        api("PUT", f"/workflows/{wid}", body)
        action = "updated"
    else:
        wid = api("POST", "/workflows", body)["id"]
        action = "created"
    if not inactive:
        api("POST", f"/workflows/{wid}/activate")
    print(f"{action} {wid} {'inactive' if inactive else 'active'}  {wf['name']}")

print("N8N_CREDENTIAL_IDS=" + json.dumps(cred_ids))
