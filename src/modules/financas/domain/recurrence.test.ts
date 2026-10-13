import { describe, expect, it } from "vitest";
import { addDays, addMonthsAnchored, daysBetween } from "@/lib/dates";
import { describeRule, generationWindow, occurrencesBetween, type RecurrenceRule } from "./recurrence";

const rule = (partial: Partial<RecurrenceRule>): RecurrenceRule => ({
  startDate: "2026-01-31",
  frequency: "mensal",
  intervalMonths: 1,
  endDate: null,
  ...partial,
});

describe("datas civis auxiliares", () => {
  it("soma dias atravessando mês e ano bissexto", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("soma meses preservando a âncora", () => {
    expect(addMonthsAnchored("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsAnchored("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsAnchored("2024-01-30", 1)).toBe("2024-02-29");
    expect(addMonthsAnchored("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("occurrencesBetween — mensal", () => {
  it("série do dia 31 ajusta e volta ao 31", () => {
    expect(occurrencesBetween(rule({}), "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("fevereiro bissexto recebe o dia 29", () => {
    expect(occurrencesBetween(rule({ startDate: "2023-12-29" }), "2024-02-01", "2024-03-31")).toEqual(["2024-02-29", "2024-03-29"]);
    expect(occurrencesBetween(rule({ startDate: "2024-01-31" }), "2024-02-01", "2024-02-29")).toEqual(["2024-02-29"]);
  });

  it("a cada N meses: trimestral, semestral e anual", () => {
    expect(occurrencesBetween(rule({ startDate: "2026-01-15", intervalMonths: 3 }), "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
    expect(occurrencesBetween(rule({ startDate: "2026-03-31", intervalMonths: 6 }), "2026-01-01", "2027-12-31")).toEqual([
      "2026-03-31",
      "2026-09-30",
      "2027-03-31",
      "2027-09-30",
    ]);
    expect(occurrencesBetween(rule({ startDate: "2024-02-29", intervalMonths: 12 }), "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("respeita data final e janelas que começam no meio da série", () => {
    expect(occurrencesBetween(rule({ endDate: "2026-03-30" }), "2026-01-01", "2026-12-31")).toEqual(["2026-01-31", "2026-02-28"]);
    expect(occurrencesBetween(rule({}), "2026-03-01", "2026-03-31")).toEqual(["2026-03-31"]);
    expect(occurrencesBetween(rule({ startDate: "2026-05-10" }), "2026-01-01", "2026-04-30")).toEqual([]);
  });

  it("janela muito posterior ao início não perde ocorrências", () => {
    const dates = occurrencesBetween(rule({ startDate: "2026-01-31" }), "2030-02-01", "2030-03-31");
    expect(dates).toEqual(["2030-02-28", "2030-03-31"]);
  });
});

describe("occurrencesBetween — semanal e a cada 2 semanas", () => {
  it("semanal a cada 7 dias", () => {
    expect(occurrencesBetween(rule({ startDate: "2026-09-28", frequency: "semanal" }), "2026-09-01", "2026-10-20")).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("a cada 2 semanas = 14 dias (não duas vezes por mês)", () => {
    const dates = occurrencesBetween(rule({ startDate: "2026-02-20", frequency: "quinzenal" }), "2026-02-01", "2026-04-30");
    expect(dates).toEqual(["2026-02-20", "2026-03-06", "2026-03-20", "2026-04-03", "2026-04-17"]);
    for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1], dates[i])).toBe(14);
  });

  it("janela começando no meio mantém o alinhamento", () => {
    expect(occurrencesBetween(rule({ startDate: "2026-01-01", frequency: "quinzenal" }), "2026-12-20", "2027-01-31")).toEqual([
      "2026-12-31",
      "2027-01-14",
      "2027-01-28",
    ]);
  });
});

describe("describeRule", () => {
  it("descreve periodicidades", () => {
    expect(describeRule(rule({}))).toBe("Mensal, dia 31 (ajusta ao último dia quando o mês é menor)");
    expect(describeRule(rule({ startDate: "2026-01-10", intervalMonths: 3 }))).toBe("Trimestral, dia 10");
    expect(describeRule(rule({ startDate: "2026-09-28", frequency: "semanal" }))).toBe("Semanal (toda segunda-feira)");
    expect(describeRule(rule({ startDate: "2026-09-28", frequency: "quinzenal" }))).toBe("A cada 2 semanas (segunda-feira, a cada 14 dias)");
  });
});

describe("generationWindow (alvo de geração das telas)", () => {
  const today = "2026-09-28";
  it("mês próximo: usa o horizonte padrão (fim do mês de hoje + 12)", () => {
    expect(generationWindow("2026-10-31", today)).toEqual({ target: "2027-09-30", limit: "2036-09-30", truncated: false });
  });
  it("mês futuro + 12 meses de projeção: gera exatamente até onde a tela precisa", () => {
    expect(generationWindow("2029-10-31", today)).toEqual({ target: "2029-10-31", limit: "2036-09-30", truncated: false });
  });
  it("além do limite de segurança: limita e sinaliza totais incompletos", () => {
    expect(generationWindow("2040-01-31", today)).toEqual({ target: "2036-09-30", limit: "2036-09-30", truncated: true });
    expect(generationWindow("2036-09-30", today).truncated).toBe(false);
  });
});
