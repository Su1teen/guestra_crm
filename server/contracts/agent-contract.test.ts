import { describe, expect, it } from "vitest";
import { isExplicitConfirmation } from "./agent-contract.js";

describe("remote prepayment confirmation", () => {
  it.each(["Да, выставляйте счёт", "Да, выставляйте счет", "выставляйте счёт", "Да"])(
    "accepts the explicit confirmation %s",
    (text) => expect(isExplicitConfirmation(text, "create_remote_prepayment")).toBe(true),
  );

  it.each(["Не выставляйте счёт", "Да, бронируйте", "Можно узнать цену?"])(
    "rejects another intent %s",
    (text) => expect(isExplicitConfirmation(text, "create_remote_prepayment")).toBe(false),
  );
});
