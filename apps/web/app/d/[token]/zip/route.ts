import { printableHtml, safeFileName, zipStore } from "@digimuza/staffing/compliance/pure"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { getPublicEnv } from "@/env"

/**
 * ZIP of a client document package behind a public link (`/d/<token>/zip`,
 * DIG-113). Convex checks the token and its expiry, logs the download and
 * returns the files' URLs; they are fetched here and stored in one ZIP with an
 * index page. No session.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const client = new ConvexHttpClient(getPublicEnv().CONVEX_URL)
  const res = await client.mutation(api.compliance.openSharedPackage, { token: decodeURIComponent(token), kind: "zip", userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? undefined })
  if (res.state !== "ok") return new Response(res.state === "expired" ? "Link expired" : res.state === "revoked" ? "Link revoked" : "Not found", { status: res.state === "not_found" ? 404 : 410 })
  const files: { name: string; data: Uint8Array }[] = [{ name: `00 ${safeFileName(res.subject)}.html`, data: new TextEncoder().encode(printableHtml(res.subject, res.html)) }]
  for (const f of res.files) {
    const r = await fetch(f.url, { signal: AbortSignal.timeout(30_000) })
    if (r.ok) files.push({ name: `${safeFileName(f.folder)}/${safeFileName(f.name)}`, data: new Uint8Array(await r.arrayBuffer()) })
  }
  const zip = zipStore(files)
  return new Response(zip as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFileName(res.code))}-dokumentai.zip"; filename*=UTF-8''${encodeURIComponent(`${safeFileName(res.code)} dokumentai.zip`)}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  })
}
