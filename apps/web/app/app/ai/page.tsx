import { AI_CHAT_PERMISSION } from "@/lib/ai/api"
import { requireSession } from "@/lib/system-server"
import { AiPromptStarter } from "@/components/ai/prompt-starter"
import { AiHome } from "./ai-home"

export default async function AiPage() {
  await requireSession({ permission: AI_CHAT_PERMISSION })
  return (
    <>
      <AiPromptStarter />
      <AiHome />
    </>
  )
}
