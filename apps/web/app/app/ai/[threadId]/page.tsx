import { AI_CHAT_PERMISSION } from "@/lib/ai/api"
import { requireSession } from "@/lib/system-server"
import { ThreadView } from "./thread-view"

export default async function AiThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  await requireSession({ permission: AI_CHAT_PERMISSION })
  const { threadId } = await params
  return <ThreadView threadId={threadId} />
}
