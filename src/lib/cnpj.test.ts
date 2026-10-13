import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj, parseCnpj } from "./cnpj";

// Números de exemplo (fictícios), com dígitos verificadores corretos.
const NUMERIC = "11222333000181";
const ALPHANUMERIC = "12ABC34501DE35";

describe("número do CNPJ", () => {
  it("tira a pontuação e põe as letras em maiúsculas", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe(NUMERIC);
    expect(normalizeCnpj(" 12.abc.345/01de-35 ")).toBe(ALPHANUMERIC);
  });

  it("confere os dígitos verificadores, no formato numérico e no alfanumérico", () => {
    expect(isValidCnpj(NUMERIC)).toBe(true);
    expect(isValidCnpj("11444777000161")).toBe(true);
    expect(isValidCnpj(ALPHANUMERIC)).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("12ABC34501DE53")).toBe(false);
  });

  it("recusa tamanho errado, letra nos dígitos verificadores e sequência de um caractere só", () => {
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("112223330001811")).toBe(false);
    expect(isValidCnpj("112223330001A1")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(false);
  });

  it("mostra com a máscara", () => {
    expect(formatCnpj(NUMERIC)).toBe("11.222.333/0001-81");
    expect(formatCnpj(ALPHANUMERIC)).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("123")).toBe("123");
  });

  it("campo do formulário: vazio é 'não informado'; senão precisa ser um CNPJ válido", () => {
    expect(parseCnpj("")).toEqual({ ok: true, cnpj: null });
    expect(parseCnpj("  ")).toEqual({ ok: true, cnpj: null });
    expect(parseCnpj("11.222.333/0001-81")).toEqual({ ok: true, cnpj: NUMERIC });
    expect(parseCnpj("12.abc.345/01de-35")).toEqual({ ok: true, cnpj: ALPHANUMERIC });
    expect(parseCnpj("11.222.333/0001")).toEqual({ ok: false, error: "O CNPJ tem 14 caracteres." });
    expect(parseCnpj("11.222.333/0001-80")).toEqual({ ok: false, error: "CNPJ inválido. Confira os números." });
    expect(parseCnpj(null)).toEqual({ ok: false, error: "CNPJ inválido." });
  });
});
