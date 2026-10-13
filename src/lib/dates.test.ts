import { describe, expect, it } from "vitest";
import {
  formatCivilDate,
  formatMonthLabel,
  parseCivilDate,
  parseYearMonth,
  todayInSaoPaulo,
} from "./dates";

describe("formatCivilDate", () => {
  it("formata como DD/MM/AAAA sem deslocar o dia pelo fuso", () => {
    // new Date("2026-01-01") em São Paulo exibiria 31/12/2025.
    expect(formatCivilDate("2026-01-01")).toBe("01/01/2026");
    expect(formatCivilDate("2026-09-28")).toBe("28/09/2026");
  });

  it("rejeita datas inexistentes", () => {
    expect(() => formatCivilDate("2026-02-29")).toThrow(RangeError);
    expect(() => formatCivilDate("2026-9-28")).toThrow(RangeError);
    expect(formatCivilDate("2024-02-29")).toBe("29/02/2024");
  });
});

describe("parseCivilDate", () => {
  it("valida o último dia de cada mês", () => {
    expect(parseCivilDate("2026-04-31")).toBeNull();
    expect(parseCivilDate("2026-04-30")).toEqual({ year: 2026, month: 4, day: 30 });
  });
});

describe("todayInSaoPaulo", () => {
  it("ainda é o dia anterior um segundo antes da meia-noite local", () => {
    // 02:59:59 UTC = 23:59:59 em São Paulo (UTC-3).
    expect(todayInSaoPaulo(new Date("2026-09-28T02:59:59Z"))).toBe("2026-09-27");
  });

  it("vira o dia exatamente à meia-noite local", () => {
    expect(todayInSaoPaulo(new Date("2026-09-28T03:00:00Z"))).toBe("2026-09-28");
  });

  it("não antecipa o ano novo pelo horário UTC", () => {
    expect(todayInSaoPaulo(new Date("2027-01-01T02:30:00Z"))).toBe("2026-12-31");
  });
});

describe("parseYearMonth", () => {
  it("aceita apenas meses válidos no formato YYYY-MM", () => {
    expect(parseYearMonth("2026-12")).toEqual({ year: 2026, month: 12 });
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("2026-1")).toBeNull();
    expect(parseYearMonth(undefined)).toBeNull();
  });
});

describe("formatMonthLabel", () => {
  it("escreve o mês em português", () => {
    expect(formatMonthLabel({ year: 2026, month: 3 })).toBe("Março de 2026");
  });
});
