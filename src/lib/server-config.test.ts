import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./server-config";

const valid = {
  NEON_AUTH_BASE_URL: "https://ep-exemplo.neonauth.exemplo.invalid/neondb/auth",
  NEON_AUTH_COOKIE_SECRET: "x".repeat(32),
  APP_DATABASE_URL: "postgresql://app_runtime:senha-ficticia@ep-exemplo-pooler.exemplo.invalid/neondb?sslmode=require",
};

describe("parseServerConfig", () => {
  it("aceita a configuração completa do papel de execução", () => {
    const result = parseServerConfig(valid);
    expect(result.ok).toBe(true);
  });

  it("falha fechada quando falta configuração, citando só os nomes", () => {
    const result = parseServerConfig({});
    expect(result.ok).toBe(false);
    const text = !result.ok ? result.problems.join(" ") : "";
    expect(text).toContain("NEON_AUTH_BASE_URL ausente");
    expect(text).toContain("NEON_AUTH_COOKIE_SECRET ausente");
    expect(text).toContain("APP_DATABASE_URL ausente");
  });

  it("exige segredo de cookie com pelo menos 32 caracteres", () => {
    expect(parseServerConfig({ ...valid, NEON_AUTH_COOKIE_SECRET: "x".repeat(31) }).ok).toBe(false);
  });

  it("exige HTTPS no Neon Auth", () => {
    expect(parseServerConfig({ ...valid, NEON_AUTH_BASE_URL: "http://exemplo.invalid/auth" }).ok).toBe(false);
  });

  it("recusa a conexão do dono do banco (BYPASSRLS) sem expor o valor", () => {
    const owner = "postgresql://neondb_owner:segredo-ficticio@ep-exemplo.exemplo.invalid/neondb";
    const result = parseServerConfig({ ...valid, APP_DATABASE_URL: owner });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("segredo-ficticio");
  });

  it("recusa URL que não é PostgreSQL", () => {
    expect(parseServerConfig({ ...valid, APP_DATABASE_URL: "https://exemplo.invalid" }).ok).toBe(false);
  });
});
