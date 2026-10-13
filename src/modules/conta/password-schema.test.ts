import { describe, expect, it } from "vitest";
import { changePasswordSchema } from "./password-schema";

const base = {
  currentPassword: "senha-atual-ficticia",
  newPassword: "nova-senha-ficticia-1",
  confirmation: "nova-senha-ficticia-1",
};
const firstError = (value: unknown) => changePasswordSchema.safeParse(value).error?.issues[0]?.message;

describe("changePasswordSchema", () => {
  it("aceita troca válida", () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });

  it("exige a senha atual", () => {
    expect(firstError({ ...base, currentPassword: "" })).toBe("Informe a senha atual.");
  });

  it("aplica o mínimo de 12 caracteres e a confirmação", () => {
    expect(firstError({ ...base, newPassword: "curta", confirmation: "curta" })).toBe("Use pelo menos 12 caracteres.");
    expect(firstError({ ...base, confirmation: "outra-senha-ficticia" })).toBe("As senhas não conferem.");
  });

  it("recusa nova senha igual à atual", () => {
    const same = { currentPassword: base.newPassword, newPassword: base.newPassword, confirmation: base.newPassword };
    expect(firstError(same)).toBe("A nova senha deve ser diferente da atual.");
  });
});
