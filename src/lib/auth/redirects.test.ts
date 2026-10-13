import { describe, expect, it } from "vitest";
import { buildLoginPath, getProxyRedirect, sanitizeNextPath } from "./redirects";

describe("sanitizeNextPath", () => {
  it("aceita rotas internas e preserva a query", () => {
    expect(sanitizeNextPath("/plantoes?mes=2024-02")).toBe("/plantoes?mes=2024-02");
    expect(sanitizeNextPath("/minha-conta")).toBe("/minha-conta");
    expect(sanitizeNextPath("/")).toBe("/");
  });

  it.each([
    "https://exemplo.com",
    "//exemplo.com",
    "/\\exemplo.com",
    "\\\\exemplo.com",
    "javascript:alert(1)",
    "financas",
    "/%0a//exemplo.com".replace("%0a", "\n"),
    "/\texemplo",
    "",
  ])("rejeita destino externo ou inseguro: %j", (value) => {
    expect(sanitizeNextPath(value)).toBe("/");
  });

  it("rejeita valores que não são texto ou são longos demais", () => {
    expect(sanitizeNextPath(undefined)).toBe("/");
    expect(sanitizeNextPath(["/financas"])).toBe("/");
    expect(sanitizeNextPath(`/${"a".repeat(600)}`)).toBe("/");
  });

  it("não devolve o próprio login, evitando voltar para ele", () => {
    expect(sanitizeNextPath("/login")).toBe("/");
    expect(sanitizeNextPath("/login?next=/financas")).toBe("/");
    expect(sanitizeNextPath("/redefinir-senha?token=x")).toBe("/");
  });

  it("normaliza segmentos de ponto sem sair do sistema", () => {
    expect(sanitizeNextPath("/financas/../plantoes")).toBe("/plantoes");
    expect(sanitizeNextPath("/../../exemplo.com")).toBe("/exemplo.com");
  });
});

describe("getProxyRedirect", () => {
  it("manda visitante sem sessão para o login com o destino codificado", () => {
    expect(getProxyRedirect("/plantoes", "?mes=2024-02", false)).toBe(
      "/login?next=%2Fplantoes%3Fmes%3D2024-02",
    );
    expect(getProxyRedirect("/", "", false)).toBe("/login");
  });

  it("protege todas as rotas, inclusive as desconhecidas", () => {
    for (const path of ["/financas", "/follow-up", "/minha-conta", "/qualquer"]) {
      expect(getProxyRedirect(path, "", false)).toMatch(/^\/login/);
    }
  });

  it("não redireciona o login nem usuários autenticados (sem laços)", () => {
    expect(getProxyRedirect("/login", "", false)).toBeNull();
    expect(getProxyRedirect("/redefinir-senha", "?token=x", false)).toBeNull();
    expect(getProxyRedirect("/login", "", true)).toBeNull();
    expect(getProxyRedirect("/financas", "", true)).toBeNull();
  });
});

describe("buildLoginPath", () => {
  it("omite o destino padrão", () => {
    expect(buildLoginPath("/", "")).toBe("/login");
  });
});
