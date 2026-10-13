import { describe, expect, it } from "vitest";
import { nowInSaoPaulo } from "@/lib/dates";
import { classifyShift } from "./dashboard";

const today = "2026-10-31";
const night = { start: "19:00", end: "07:00", nextDay: true };
const day = { start: "07:00", end: "19:00", nextDay: false };

describe("plantões no dashboard", () => {
  it("noturno de ontem ainda em andamento aparece em Hoje; depois do fim vai para A confirmar", () => {
    expect(classifyShift({ date: "2026-10-30", hours: night }, today, 6 * 60)).toEqual({ section: "hoje", status: "em_andamento" });
    expect(classifyShift({ date: "2026-10-30", hours: night }, today, 7 * 60)).toEqual({ section: "a_confirmar", status: "a_confirmar" });
  });
  it("hoje: futuro, em andamento e já terminado", () => {
    expect(classifyShift({ date: today, hours: day }, today, 6 * 60)).toEqual({ section: "hoje", status: "hoje" });
    expect(classifyShift({ date: today, hours: day }, today, 12 * 60)).toEqual({ section: "hoje", status: "em_andamento" });
    expect(classifyShift({ date: today, hours: day }, today, 19 * 60)).toEqual({ section: "a_confirmar", status: "a_confirmar" });
  });
  it("sem horário: hoje fica em Hoje; dias anteriores a confirmar", () => {
    expect(classifyShift({ date: today, hours: null }, today, 23 * 60)).toEqual({ section: "hoje", status: "hoje" });
    expect(classifyShift({ date: "2026-10-30", hours: null }, today, 0)).toEqual({ section: "a_confirmar", status: "a_confirmar" });
  });
  it("próximos 7 dias atravessando o mês (amanhã até hoje + 7)", () => {
    expect(classifyShift({ date: "2026-11-01", hours: day }, today, 0)).toEqual({ section: "proximos", status: "proximo" });
    expect(classifyShift({ date: "2026-11-07", hours: null }, today, 0)).toEqual({ section: "proximos", status: "proximo" });
    expect(classifyShift({ date: "2026-11-08", hours: null }, today, 0)).toBeNull();
  });
  it("24 h iniciado ontem às 07:00 termina hoje às 07:00", () => {
    const h24 = { start: "07:00", end: "07:00", nextDay: true };
    expect(classifyShift({ date: "2026-10-30", hours: h24 }, today, 6 * 60 + 59)).toEqual({ section: "hoje", status: "em_andamento" });
    expect(classifyShift({ date: "2026-10-30", hours: h24 }, today, 7 * 60)).toEqual({ section: "a_confirmar", status: "a_confirmar" });
  });
});

describe("instante de referência em São Paulo", () => {
  it("virada do dia no fuso de São Paulo (UTC−3), não no do servidor", () => {
    expect(nowInSaoPaulo(new Date("2026-11-01T02:59:00Z"))).toEqual({ date: "2026-10-31", minutes: 23 * 60 + 59 });
    expect(nowInSaoPaulo(new Date("2026-11-01T03:00:00Z"))).toEqual({ date: "2026-11-01", minutes: 0 });
    expect(nowInSaoPaulo(new Date("2026-12-31T23:30:00-03:00"))).toEqual({ date: "2026-12-31", minutes: 23 * 60 + 30 });
  });
});
