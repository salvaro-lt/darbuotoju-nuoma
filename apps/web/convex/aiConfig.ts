// The AI assistant's agents and tools. Shared by convex/ai.ts (default runtime)
// and convex/aiRunner.ts ("use node"), so this file must NOT be "use node" and
// must not import Mastra or the AI SDK.
//
// A module exposes its actions to the assistant with `defineAiTool` (permission =
// the module's own permission, writes require approval). Add its tools here.
import { defineAiAgent, displayTools, type AiOptions } from "@digimuza/system-core/ai"
import { defineAutomationsAiTools } from "@digimuza/system-core/automations"
import { defineIngestAiTools } from "@digimuza/system-core/ingest"
import { financeTools } from "@digimuza/system-core/finance"
import { documentsTools } from "@digimuza/documents"
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
  tools: [...financeTools, ...documentsTools, ...automationTools, ...ingestTools, ...displayTools],
})

export const aiOptions: AiOptions = {
  agents: [assistant],
  // Small, fast model with tool calling and streaming on the 9Router proxy
  // (OPENAI_BASE_URL=https://router.digimuza.ai/v1). It must exist on the router.
  // AI_MODEL on the Convex deployment overrides it (alternative: `cx/gpt-6.1-sol`).
  defaultModel: "cc/claude-haiku-4-5-20251001",
}
