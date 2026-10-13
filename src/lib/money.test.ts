import { describe, expect, it } from "vitest";
import {
  bigintFromDb,
  centsFromDb,
  formatCents,
  formatCentsForInput,
  MAX_AMOUNT_CENTS,
  parseBrlToCents,
} from "./money";

// O Intl separa "R$" do número com espaço não separável.
const brl = (text: string) => text.replace(" ", " ");

describe("formatCents", () => {
  it("formata centavos em reais no padrão brasileiro", () => {
    expect(formatCents(123456)).toBe(brl("R$ 1.234,56"));
    expect(formatCents(0)).toBe(brl("R$ 0,00"));
    expect(formatCents(5)).toBe(brl("R$ 0,05"));
  });

  it("formata valores negativos", () => {
    expect(formatCents(-1990)).toBe(`-${brl("R$ 19,90")}`);
  });

  it("é exato no maior inteiro seguro e em totais bigint acima dele", () => {
    expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe(brl("R$ 90.071.992.547.409,91"));
    expect(formatCents(9007199254740993n)).toBe(brl("R$ 90.071.992.547.409,93"));
  });

  it("rejeita frações de centavo e inteiros fora do intervalo seguro", () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
    expect(() => formatCents(2 ** 53)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });
});

describe("parseBrlToCents", () => {
  const cents = (input: string) => {
    const result = parseBrlToCents(input);
    return result.ok ? result.cents : result.error;
  };

  it("aceita os formatos brasileiros usuais", () => {
    expect(cents("1234,56")).toBe(123456);
    expect(cents("1.234,56")).toBe(123456);
    expect(cents("1.234.567,89")).toBe(123456789);
    expect(cents("1234")).toBe(123400);
    expect(cents("1.234")).toBe(123400);
    expect(cents("0,5")).toBe(50);
    expect(cents("0,01")).toBe(1);
    expect(cents(" R$ 1.234,56 ")).toBe(123456);
    expect(cents("R$ 12,30")).toBe(1230);
  });

  it("converte pelos dígitos, sem erro de ponto flutuante", () => {
    // 0,29 * 100 em ponto flutuante daria 28,999999999999996.
    expect(cents("0,29")).toBe(29);
    expect(cents("1,15")).toBe(115);
    expect(cents("4,35")).toBe(435);
  });

  it("rejeita zero, negativos e frações de centavo", () => {
    expect(cents("0")).toBe("O valor deve ser maior que zero.");
    expect(cents("0,00")).toBe("O valor deve ser maior que zero.");
    expect(cents("-10,00")).toBe("O valor deve ser positivo.");
    expect(cents("10,001")).toBe("Use no máximo 2 casas decimais.");
  });

  it("rejeita formatos ambíguos ou inválidos", () => {
    for (const input of ["12.5", "1,234.56", "1.23,45", "12,", ",50", "1e3", "abc", "1 234", "12,3,4", "Infinity"]) {
      expect(parseBrlToCents(input).ok, input).toBe(false);
    }
    expect(cents("")).toBe("Informe o valor.");
    expect(parseBrlToCents(123 as unknown).ok).toBe(false);
  });

  it("aplica o limite máximo compartilhado com o banco", () => {
    expect(cents("99.999.999,99")).toBe(MAX_AMOUNT_CENTS);
    expect(parseBrlToCents("100.000.000,00").ok).toBe(false);
    expect(parseBrlToCents("99999999999999999999999").ok).toBe(false);
  });
});

describe("formatCentsForInput", () => {
  it("gera texto que o parser lê de volta sem perda", () => {
    for (const value of [1, 50, 123456, MAX_AMOUNT_CENTS]) {
      const text = formatCentsForInput(value);
      expect(parseBrlToCents(text)).toEqual({ ok: true, cents: value });
    }
    expect(formatCentsForInput(123456789)).toBe("1.234.567,89");
  });
});

describe("leitura de bigint do PostgreSQL", () => {
  it("converte texto int8 sem perder precisão", () => {
    expect(centsFromDb("9999999999")).toBe(9999999999);
    expect(bigintFromDb("9007199254740993")).toBe(9007199254740993n);
    expect(bigintFromDb(null)).toBe(0n);
  });

  it("recusa valores inseguros ou malformados", () => {
    expect(() => centsFromDb("9007199254740993")).toThrow(RangeError);
    expect(() => bigintFromDb("12.5")).toThrow(RangeError);
    expect(() => bigintFromDb(1.5)).toThrow(RangeError);
  });
});
