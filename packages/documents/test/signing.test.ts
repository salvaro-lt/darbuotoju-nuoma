import { PDFDocument } from "pdf-lib"
import { describe, expect, test } from "vitest"
import { fieldProblems, valueProblems, type SigningField } from "../src/signing"
import { buildSignedPdfBytes } from "../src/stamp"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const sig: SigningField = { id: "sig", type: "signature", role: 0, label: "", required: true, page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.08 }
const name: SigningField = { id: "name", type: "name", role: 0, label: "Vardas", required: true, page: 0, x: 0.1, y: 0.7, w: 0.3, h: 0.04 }
const other: SigningField = { id: "other", type: "date", role: 1, label: "", required: true, page: 0, x: 0.5, y: 0.7, w: 0.2, h: 0.04 }

describe("signing fields", () => {
  test("template field checks", () => {
    expect(fieldProblems([sig, name, other], 2, 1)).toEqual([])
    expect(fieldProblems([{ ...sig, x: 0.9 }], 1, 1)).toEqual(["fields.0.box"])
    expect(fieldProblems([sig, { ...name, id: "sig" }], 1, 1)).toEqual(["fields.1.id"])
    expect(fieldProblems([{ ...sig, role: 3, page: 2 }], 1, 1)).toEqual(["fields.0.role", "fields.0.page"])
  })

  test("a signer fills only their own fields, required ones included", () => {
    expect(valueProblems([sig, name, other], 0, { sig: PNG, name: "Jonas Jonaitis" })).toEqual([])
    expect(valueProblems([sig, name, other], 0, { sig: PNG })).toEqual(["name"])
    expect(valueProblems([sig, name, other], 0, { sig: "data:text/html,<b>", name: "J" })).toEqual(["sig"])
    expect(valueProblems([sig, name, other], 0, { sig: PNG, name: "J", other: "2026-01-01" })).toEqual(["other"])
  })

  test("the signed PDF keeps the pages and adds a certificate", async () => {
    const src = await PDFDocument.create()
    src.addPage([595, 842])
    const pdf = await buildSignedPdfBytes({
      pdf: await src.save(),
      fields: [sig, name],
      values: { sig: PNG, name: "Ąžuolas Čėsnys" },
      font: null,
      certificate: {
        title: "Sutartis Nr. 7",
        submissionId: "s1",
        originalSha256: "ab".repeat(32),
        locale: "lt-LT",
        lang: "lt",
        signers: [{ role: "Pirkėjas", name: "Ąžuolas Čėsnys", email: "a@b.lt", openedAt: 1, completedAt: 2, userAgent: "test", signature: PNG }],
        events: [{ at: 1, kind: "completed", who: "a@b.lt" }],
      },
    })
    const out = await PDFDocument.load(pdf)
    expect(out.getPageCount()).toBe(2)
  })
})
