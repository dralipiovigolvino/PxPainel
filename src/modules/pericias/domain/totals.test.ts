import { describe, expect, it } from "vitest";
import { examTotals, matchesFilters, needsConfirmation } from "./totals";

describe("totais de perícias", () => {
  it("separa agendadas e realizadas, usa a alíquota de cada perícia e deixa canceladas de fora", () => {
    const t = examTotals([
      { status: "agendada", amountCents: 100000, taxRateBp: 900 }, // imposto 90,00
      { status: "agendada", amountCents: 50000, taxRateBp: 1100 }, // imposto 55,00 (alíquota antiga preservada)
      { status: "realizada", amountCents: 80000, taxRateBp: 900 }, // imposto 72,00
      { status: "cancelada", amountCents: 999999, taxRateBp: 900 },
    ]);
    expect(t.agendadas).toEqual({ count: 2, gross: 150000n, tax: 14500n, net: 135500n });
    expect(t.realizadas).toEqual({ count: 1, gross: 80000n, tax: 7200n, net: 72800n });
    expect(t.total).toEqual({ count: 3, gross: 230000n, tax: 21700n, net: 208300n });
    expect(t.canceledCount).toBe(1);
    expect(t.total.tax + t.total.net).toBe(t.total.gross);
  });

  it("período vazio", () => {
    expect(examTotals([]).total).toEqual({ count: 0, gross: 0n, tax: 0n, net: 0n });
  });

  it("a confirmar: agendada com horário passado; nunca muda a situação sozinha", () => {
    const e = { status: "agendada", date: "2026-10-04", time: "09:30" };
    expect(needsConfirmation(e, "2026-10-04", 9 * 60)).toBe(false);
    expect(needsConfirmation(e, "2026-10-04", 9 * 60 + 31)).toBe(true);
    expect(needsConfirmation(e, "2026-10-05", 0)).toBe(true);
    expect(needsConfirmation(e, "2026-10-03", 23 * 60)).toBe(false);
    expect(needsConfirmation({ ...e, status: "realizada" }, "2026-10-05", 0)).toBe(false);
  });

  it("filtros por empresa e situação", () => {
    const e = { companyId: "c1", status: "agendada" as const, date: "2026-10-01", time: "08:00" };
    expect(matchesFilters(e, { companyId: null, situation: "todas" }, "2026-10-04", 0)).toBe(true);
    expect(matchesFilters(e, { companyId: "c2", situation: "todas" }, "2026-10-04", 0)).toBe(false);
    expect(matchesFilters(e, { companyId: "c1", situation: "a-confirmar" }, "2026-10-04", 0)).toBe(true);
    expect(matchesFilters(e, { companyId: "c1", situation: "realizada" }, "2026-10-04", 0)).toBe(false);
  });
});
