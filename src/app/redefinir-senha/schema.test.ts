import { describe, expect, it } from "vitest";
import { newPasswordSchema } from "./schema";

const base = { token: "token-ficticio", password: "senha-ficticia-longa", confirmation: "senha-ficticia-longa" };

describe("newPasswordSchema", () => {
  it("aceita senha longa e confirmada", () => {
    expect(newPasswordSchema.safeParse(base).success).toBe(true);
  });

  it("exige no mínimo 12 caracteres", () => {
    const result = newPasswordSchema.safeParse({ ...base, password: "curta123", confirmation: "curta123" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Use pelo menos 12 caracteres.");
  });

  it("exige confirmação idêntica", () => {
    const result = newPasswordSchema.safeParse({ ...base, confirmation: "outra-senha-qualquer" });
    expect(result.error?.issues[0]?.message).toBe("As senhas não conferem.");
  });

  it("exige o token do link", () => {
    expect(newPasswordSchema.safeParse({ ...base, token: "" }).success).toBe(false);
  });
});
