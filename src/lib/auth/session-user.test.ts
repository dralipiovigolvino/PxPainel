import { describe, expect, it } from "vitest";
import { parseRoles, userFromSession } from "./session-user";

const ID = "3F2B8C1E-7A4D-4E9B-9C1A-2D5E6F708192";
const NOW = new Date("2026-09-28T12:00:00Z");
const session = (user: Record<string, unknown>, expiresAt = "2026-09-29T12:00:00Z") => ({
  user,
  session: { expiresAt },
});

describe("userFromSession", () => {
  it("aceita usuário com papel autorizado e normaliza o id", () => {
    expect(userFromSession(session({ id: ID, email: "a@exemplo.invalid", role: "painel" }), NOW)).toEqual({
      id: ID.toLowerCase(),
      email: "a@exemplo.invalid",
    });
    expect(userFromSession(session({ id: ID, role: "user,admin" }), NOW)?.id).toBe(ID.toLowerCase());
  });

  it("recusa conta sem papel autorizado (ex.: criada fora do provisionamento)", () => {
    expect(userFromSession(session({ id: ID, role: "user" }), NOW)).toBeNull();
    expect(userFromSession(session({ id: ID }), NOW)).toBeNull();
    expect(userFromSession(session({ id: ID, role: "administrador" }), NOW)).toBeNull();
  });

  it("recusa conta banida, sessão expirada e sessão ausente", () => {
    expect(userFromSession(session({ id: ID, role: "admin", banned: true }), NOW)).toBeNull();
    expect(userFromSession(session({ id: ID, role: "admin" }, "2026-09-28T11:59:59Z"), NOW)).toBeNull();
    expect(userFromSession({ user: { id: ID, role: "admin" }, session: null }, NOW)).toBeNull();
    expect(userFromSession(null, NOW)).toBeNull();
  });

  it("recusa id fora do formato UUID", () => {
    expect(userFromSession(session({ id: "1 or 1=1", role: "admin" }), NOW)).toBeNull();
  });
});

describe("parseRoles", () => {
  it("separa papéis por vírgula e ignora vazios", () => {
    expect(parseRoles(" admin, painel ,")).toEqual(["admin", "painel"]);
    expect(parseRoles(undefined)).toEqual([]);
  });
});
