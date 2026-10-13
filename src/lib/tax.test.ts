import { describe, expect, it } from "vitest";
import { amountBreakdown, estimateTax, formatRate, formatRateForInput, parseRate } from "./tax";

describe("impostos estimados", () => {
  it("R$ 1.000,00 a 9% = R$ 90,00 de imposto e R$ 910,00 após impostos", () => {
    expect(estimateTax(100000, 900)).toEqual({ taxCents: 9000, netCents: 91000 });
  });

  it("percentual alterado e com decimais", () => {
    expect(estimateTax(100000, 1100)).toEqual({ taxCents: 11000, netCents: 89000 });
    expect(estimateTax(100000, 925)).toEqual({ taxCents: 9250, netCents: 90750 });
    expect(estimateTax(123456, 0)).toEqual({ taxCents: 0, netCents: 123456 });
    expect(estimateTax(123456, 10000)).toEqual({ taxCents: 123456, netCents: 0 });
  });

  it("arredonda ao centavo mais próximo, meio centavo para cima, e a soma fecha no bruto", () => {
    // 9% de R$ 0,05 = 0,45 centavo → 0; de R$ 0,06 = 0,54 → 1; de R$ 0,50 = 4,5 → 5.
    expect(estimateTax(5, 900).taxCents).toBe(0);
    expect(estimateTax(6, 900).taxCents).toBe(1);
    expect(estimateTax(50, 900).taxCents).toBe(5);
    // R$ 333,33 a 9% = 29,9997 → R$ 30,00.
    expect(estimateTax(33333, 900)).toEqual({ taxCents: 3000, netCents: 30333 });
    for (const gross of [1, 99, 33333, 9_999_999_999]) {
      const r = estimateTax(gross, 925);
      expect(r.taxCents + r.netCents).toBe(gross);
    }
  });

  it("valor máximo não perde precisão", () => {
    expect(estimateTax(9_999_999_999, 900)).toEqual({ taxCents: 900_000_000, netCents: 9_099_999_999 });
  });

  it("rejeita entradas inválidas", () => {
    expect(() => estimateTax(-1, 900)).toThrow();
    expect(() => estimateTax(100, 10001)).toThrow();
    expect(() => estimateTax(100, 9.5)).toThrow();
  });

  it("bruto usa a alíquota gravada no registro; líquido não é descontado de novo; indefinido não presume", () => {
    expect(amountBreakdown(100000, "bruto", 900)).toEqual({ kind: "bruto", amountCents: 100000, rateBp: 900, taxCents: 9000, netCents: 91000 });
    expect(amountBreakdown(100000, "liquido", null)).toEqual({ kind: "liquido", amountCents: 100000, rateBp: null, taxCents: null, netCents: 100000 });
    expect(amountBreakdown(100000, null, null)).toEqual({ kind: null, amountCents: 100000, rateBp: null, taxCents: null, netCents: null });
    // Alíquota sobrando num valor líquido é ignorada (nunca desconta).
    expect(amountBreakdown(100000, "liquido", 900).netCents).toBe(100000);
  });

  it("lê e formata o percentual", () => {
    expect(parseRate("9")).toEqual({ ok: true, rateBp: 900 });
    expect(parseRate(" 9,5 % ")).toEqual({ ok: true, rateBp: 950 });
    expect(parseRate("9,25")).toEqual({ ok: true, rateBp: 925 });
    expect(parseRate("0")).toEqual({ ok: true, rateBp: 0 });
    expect(parseRate("100")).toEqual({ ok: true, rateBp: 10000 });
    for (const bad of ["", "abc", "9.5", "-1", "100,01", "9,255", "1000"]) expect(parseRate(bad).ok).toBe(false);
    expect(formatRate(900)).toBe("9%");
    expect(formatRate(950)).toBe("9,5%");
    expect(formatRate(925)).toBe("9,25%");
    expect(formatRate(905)).toBe("9,05%");
    expect(formatRateForInput(1100)).toBe("11");
  });
});
