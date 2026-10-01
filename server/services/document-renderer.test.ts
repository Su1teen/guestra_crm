import { describe, expect, it } from "vitest";
import { renderDocument, type DocumentData } from "../../shared/document-renderer.js";

const document: DocumentData = { kind: "COMMERCIAL_OFFER", code: "КП-12", issueDate: "2026-10-01T00:00:00Z", propertyName: "Лес", guestName: "Гость", lines: [{ description: "Домик", quantity: 2, amount: 20000 }], currency: "KZT", subtotal: 20000, total: 20000, deposit: 5000 };

describe("document renderer", () => {
  it("keeps offer and folio semantics separate and escapes external text", () => {
    const offer = renderDocument({ ...document, guestName: "<script>" });
    expect(offer).toContain("Коммерческое предложение");
    expect(offer).toContain("&lt;script&gt;");
    expect(offer).not.toContain("<script>");
    const folio = renderDocument({ ...document, kind: "FOLIO", paid: 10000, balance: 10000 });
    expect(folio).toContain("Предварительное фолио");
    expect(folio).toContain("Остаток");
  });
});
