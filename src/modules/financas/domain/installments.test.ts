import { describe, expect, it } from "vitest";
import { describeSplit, installmentDates, planStats, splitCents, validateInstallments } from "./installments";

const brl = (text: string) => text.replaceAll("R$ ", "R$ ");
const sum = (parts: number[]) => parts.reduce((a, b) => a + b, 0);

describe("splitCents", () => {
  it("R$ 100,00 em 3 = 33,34 + 33,33 + 33,33", () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it("resto vai para as primeiras parcelas e a soma é exata", () => {
    expect(splitCents(1001, 4)).toEqual([251, 250, 250, 250]);
    expect(splitCents(1003, 4)).toEqual([251, 251, 251, 250]);
    expect(splitCents(1200, 12)).toEqual(Array(12).fill(100));
    for (const [total, n] of [[9999999999, 7], [123457, 120], [2, 2], [99999, 13]]) {
      const parts = splitCents(total, n);
      expect(sum(parts)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      expect(parts).toEqual([...parts].sort((a, b) => b - a)); // maiores primeiro
    }
  });
});

describe("installmentDates", () => {
  it("mensais ancoradas no primeiro vencimento, com ajuste de fim de mês", () => {
    expect(installmentDates("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(installmentDates("2023-12-29", 3)).toEqual(["2023-12-29", "2024-01-29", "2024-02-29"]);
    expect(installmentDates("2026-11-15", 3)).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });
});

describe("validateInstallments", () => {
  it("recusa quantidade inválida e parcelas de valor zero", () => {
    expect(validateInstallments(10000, 1)).toMatchObject({ ok: false, field: "count" });
    expect(validateInstallments(10000, 121)).toMatchObject({ ok: false, field: "count" });
    expect(validateInstallments(10000, 2.5)).toMatchObject({ ok: false, field: "count" });
    expect(validateInstallments(2, 3)).toEqual({ ok: false, field: "total", message: "Com esse total, alguma parcela ficaria com valor zero." });
    expect(validateInstallments(3, 3)).toEqual({ ok: true });
  });
});

describe("describeSplit e planStats", () => {
  it("agrupa parcelas iguais", () => {
    expect(describeSplit(splitCents(10000, 3))).toBe(brl("1× R$ 33,34 + 2× R$ 33,33"));
    expect(describeSplit(splitCents(1200, 12))).toBe(brl("12× R$ 1,00"));
  });

  it("saldo restante = pendentes; canceladas separadas", () => {
    const s = planStats([
      { amountCents: 3334, status: "pago" },
      { amountCents: 3333, status: "pendente" },
      { amountCents: 3333, status: "cancelado" },
    ]);
    expect(s).toEqual({ paidCount: 1, paidCents: 3334n, pendingCount: 1, pendingCents: 3333n, canceledCount: 1, canceledCents: 3333n });
  });
});
