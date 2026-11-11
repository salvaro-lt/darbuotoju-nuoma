import { getConvexEnv } from "../env"

export interface Mail {
  to: string
  subject: string
  text: string
  /** Sender; default MAIL_FROM. */
  from?: string
  /** Where the recipient's reply goes (e.g. the inbox the email came to). */
  replyTo?: string
  /** Extra headers, e.g. `In-Reply-To` / `References` to keep a thread. */
  headers?: Record<string, string>
}

/**
 * Mail adapter for invites and email replies (sign-in itself is WorkOS). Sends
 * through Resend's HTTP API when RESEND_API_KEY is set. In development without a
 * key it prints the mail to the Convex log so you can test invites locally; any
 * other APP_ENV fails closed. Swap this function to use another provider.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const env = getConvexEnv()
  if (!env.RESEND_API_KEY) {
    if (env.APP_ENV !== "development") throw new Error("RESEND_API_KEY is required outside development")
    console.warn(`[dev mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`)
    return
  }
  const body: Record<string, unknown> = { from: mail.from ?? env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }
  if (mail.replyTo) body.reply_to = mail.replyTo
  if (mail.headers && Object.keys(mail.headers).length > 0) body.headers = mail.headers
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  // Status only: the body can echo the recipient or the message.
  if (!res.ok) throw new Error(`Mail delivery failed with HTTP ${res.status}`)
}
