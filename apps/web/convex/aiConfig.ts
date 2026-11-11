// The AI assistant's agents and tools. Shared by convex/ai.ts (default runtime)
// and convex/aiRunner.ts ("use node"), so this file must NOT be "use node" and
// must not import Mastra or the AI SDK.
//
// A module exposes its actions to the assistant with `defineAiTool` (permission =
// the module's own permission, writes require approval). Add its tools here.
import { defineAiAgent, displayTools, type AiAgentDefinition, type AiOptions } from "@digimuza/system-core/ai"
import { getConvexEnv } from "../env"
import { mailTools } from "./mailTools"
import { N8N_NAME_PREFIX, N8N_TAG } from "./model/n8nClient"
import { n8nTools } from "./n8nAiTools"
import { defineAutomationsAiTools } from "@digimuza/system-core/automations"
import { defineIngestAiTools } from "@digimuza/system-core/ingest"
import { financeTools } from "@digimuza/system-core/finance"
import { documentsTools } from "@digimuza/documents"
import { staffingTools } from "@digimuza/staffing"
import { automationTargets, ingestConsumers } from "./automationsConfig"

/** List, explain, test, create and change automations; approve queued results. */
const automationTools = defineAutomationsAiTools({ targets: automationTargets })
/** Gavimas: list inboxes, create one (and link it to automations) with approval. */
const ingestTools = defineIngestAiTools({ consumers: ingestConsumers })

/**
 * Automations ("Automatizacijos"): channel → AI extraction → insert. Kept as one block so
 * client apps can reuse it (convex/aiConfig.ts in each app).
 */
export const AUTOMATION_INSTRUCTIONS = [
  "Automatizacijos / automations: kanalas (el. laiškas arba webhook / forma) → AI ištraukia laukus → įrašoma per paskirties įrankį (target). Kurti ar keisti automatizaciją:",
  "1) Pirmiausia iškviesk automations.list_targets: pamatysi, kur galima įrašyti, ir kiekvieno target įvesties raktus (key, type, required).",
  "2) Iš užklausos sudaryk apibrėžimą: channel (laiškai → email, svetainės forma ar kita sistema → webhook); instructions (ką ir kaip ištraukti, lietuviškai); fields su tipais (string, number, date, email, phone, enum su options, array), required tik tiems, be kurių įrašyti negalima; actions su mapping: kiekvienam būtinam target raktui \"{{lauko_vardas}}\", {{message.text}}, {{message.subject}}, {{message.from}} arba konstanta. Jei reikia kliento ir su juo susieto įrašo, pirmas veiksmas randa ar sukuria klientą, o antrasis naudoja {{previous.customerId}} (raktas iš pirmo veiksmo rezultato).",
  "3) Jei trūksta esminės informacijos (pvz. kur įrašyti, kai tinka keli target, ar kokio kanalo reikia), paklausk vienu trumpu klausimu. Akivaizdžius dalykus nuspręsk pats.",
  "4) Prieš kviesdamas automations.create parodyk trumpą santrauką: pavadinimas, kanalas, laukai (vardas – tipas – būtinas?), kur įrašoma ir kaip susieta, režimas „peržiūra“ (rezultatai laukia patvirtinimo). Tada tame pačiame atsakyme iškviesk automations.create: naudotojas patvirtins kortelėje.",
  "5) Po sukūrimo pasakyk, kaip prijungti: el. paštui – persiųsti laiškus į inboundAddress arba naudoti jį tiesiogiai; webhook – atidaryti automatizacijos puslapį, sukurti raktą ir nukopijuoti URL ar formos kodą.",
  "Laukiantiems įrašams naudok automations.list_runs (status pending_review) ir automations.review_item. Bandymui – automations.test_extract (nieko neįrašo).",
  "Pašto dėžutės (Gavimas): ingest.list_inboxes parodo dėžutes ir gavimo domeną. Prašymui „Sukurk pašto dėžutę uzklausos ir prijunk ją prie automatizacijos X“: automations.list (rask X id), tada vienas ingest.create_inbox {name, localPart: \"uzklausos\", links: [{to: \"automations\", id}]}. El. pašto automatizacijai su konkrečia dėžute automations.create perduok inboxId; be jo sukuriama nauja dėžutė.",
].join("\n")

export const assistant = defineAiAgent({
  id: "assistant",
  name: "Asistentas",
  description: "Padeda dirbti su įmonės sistema / Helps you work with the company system",
  instructions: [
    "Tu esi šios įmonės sistemos asistentas. Atsakyk ta kalba, kuria rašo naudotojas.",
    "You are the assistant of this company's internal system. Always answer in the user's language.",
    "Use tools only when the question needs data or an action from the system; otherwise just answer.",
    "Never invent data (invoices, numbers, amounts, names, statuses). If a tool does not return it, say you don't know.",
    "If a tool fails or you lack permission, say so plainly and do not guess the result.",
    "To create, change or approve something, call the tool right away with the details the user gave. Do not ask for confirmation in text: the system itself shows the user an Approve / Reject card and runs the tool only after approval. Ask a question only when a required detail is missing.",
    "When a visual answer is clearly better (an overview with key figures, a comparison, a small table or bar chart), show it with the show_card tool and add one short sentence in the chat. Do not repeat the card's content in text.",
    "Keep answers short and clear. Amounts are in major units (e.g. 12.50 EUR).",
    AUTOMATION_INSTRUCTIONS,
  ].join("\n"),
  tools: [...financeTools, ...documentsTools, ...staffingTools, ...automationTools, ...ingestTools, ...displayTools],
})

/** The app's public URL for n8n nodes that call back. Module scope: a missing or invalid env must not break loading, so a placeholder then. */
const siteUrl = (() => {
  try {
    return getConvexEnv().SITE_URL.replace(/\/+$/, "")
  } catch {
    return "<SITE_URL>"
  }
})()

/** n8n: the automation engine. How the assistant finds, builds and runs workflows (convex/n8nAiTools.ts). */
export const N8N_INSTRUCTIONS = [
  `n8n workflow (automatizacijos n8n): matai ir keiti tik workflow su žyma ${N8N_TAG}. Esamus workflow rask su n8n.search_workflows, detales (mazgai, ryšiai, trigeriai) – n8n.get_workflow, vykdymus – n8n.list_executions.`,
  `Kurdamas workflow: pirmiausia n8n.list_node_types (tipai, typeVersion, parametrų pavyzdžiai). Trigeris – Webhook (n8n-nodes-base.webhook) arba Schedule Trigger. AI mazgams naudok OpenAI Chat Model su credentials {openAiApi: {name: "${N8N_NAME_PREFIX}9Router"}}, modelis "fast", responsesApiEnabled false. Sistemos duomenims: MCP Client Tool (endpointUrl ${siteUrl}/api/v1/mcp, serverTransport httpStreamable, authentication bearerAuth) arba HTTP Request POST ${siteUrl}/api/v1/tools/<įrankio id>, abu su credentials {httpBearerAuth: {name: "${N8N_NAME_PREFIX}API"}}.`,
  "connections perduok JSON eilute (string). Prieš n8n.create_workflow ar n8n.update_workflow trumpai aprašyk workflow (trigeris → žingsniai → rezultatas) ir iškviesk įrankį: naudotojas patvirtina kortelėje. Po patvirtinimo iškviesk n8n.get_operation su grąžintu opId ir pasakyk rezultatą (pavadinimas, ar aktyvus, nuoroda). Tas pats n8n.set_workflow_active ir n8n.execute_workflow.",
  `Laiškų workflow: Webhook trigeris (POST, header auth credentials "${N8N_NAME_PREFIX}Webhook"), tada pašto dėžutę prijunk prie jo per ingest.create_inbox su links [{to: "n8n", id: <workflowId>}]. Kiekvienas gautas laiškas POST'inamas į workflow kaip JSON {event: "email.received", deliveryId, email: {id, inbox, from, fromName, to, subject, text, html, messageId, receivedAt, attachments}} su antrašte X-Webhook-Secret. Atsakyti į gautą laišką: mail.reply_to_email {emailId, text}.`,
].join(" ")

/** Every agent also works with n8n workflows and answers received email (convex/n8nAiTools.ts, convex/mailTools.ts). */
const withN8n = <const A extends AiAgentDefinition>(agent: A) =>
  defineAiAgent({ ...agent, instructions: `${agent.instructions}\n${N8N_INSTRUCTIONS}`, tools: [...agent.tools, ...mailTools, ...n8nTools] })

/** Same instructions and tools as the assistant, on the 9Router combo `smart`. */
export const detailedAssistant = defineAiAgent({
  ...assistant,
  id: "detailed",
  name: "Išsamus",
  description: "Galingesnis modelis sudėtingesnėms užduotims ir analizei (lėtesnis, brangesnis) / Stronger model for complex tasks",
  model: "smart",
})

export const aiOptions: AiOptions = {
  agents: [withN8n(assistant), withN8n(detailedAssistant)],
  // 9Router combos (OPENAI_BASE_URL=https://router.digimuza.ai/v1): `fast` and
  // `smart` are model lists set in the router dashboard, so a model upgrade is a
  // dashboard change, not a deploy. Each must exist on the router.
  // AI_MODEL on the Convex deployment overrides `fast` for agents without their
  // own `model` (the "Išsamus" agent keeps `smart`).
  defaultModel: "fast",
}
