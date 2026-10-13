import { describe, expect, it } from "vitest";
import { renderMessage } from "./messages";
import {
  buildSteps,
  centralCounts,
  dateCorrectionPreview,
  isOverdue,
  matchesCentralFilter,
  replacementPreview,
  sortCentral,
  stepDate,
  type CentralItem,
  type ExistingStep,
} from "./plan";

describe("datas por dias corridos", () => {
  it.each([
    ["2026-09-28", 0, "2026-09-28"],
    ["2026-09-28", 1, "2026-09-29"],
    ["2026-09-28", 7, "2026-10-05"],
    ["2026-09-28", 30, "2026-10-28"],
    ["2026-12-28", 7, "2027-01-04"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-28", 2, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-01-31", 30, "2026-03-02"],
    ["2026-09-28", 3650, "2036-09-25"],
  ])("%s + D%i = %s", (consult, offset, expected) => {
    expect(stepDate(consult, offset)).toBe(expected);
  });
  it("gera em ordem de intervalo com data original = prevista", () => {
    expect(buildSteps("2026-09-28", [{ dayOffset: 7, message: "b" }, { dayOffset: 0, message: "a" }])).toEqual([
      { dayOffset: 0, message: "a", originalDate: "2026-09-28", dueDate: "2026-09-28" },
      { dayOffset: 7, message: "b", originalDate: "2026-10-05", dueDate: "2026-10-05" },
    ]);
  });
});

const step = (id: string, dayOffset: number, status: ExistingStep["status"], extra: Partial<ExistingStep> = {}): ExistingStep => ({
  id,
  dayOffset,
  status,
  dueDate: stepDate("2026-09-28", dayOffset),
  originalDate: stepDate("2026-09-28", dayOffset),
  rescheduled: false,
  customized: false,
  ...extra,
});

describe("substituição de pendentes", () => {
  const existing = [
    step("d1", 1, "realizado"),
    step("d7", 7, "pendente"),
    step("d15", 15, "pendente", { rescheduled: true, dueDate: "2026-10-20" }),
    step("d30", 30, "pendente"),
    step("d3", 3, "cancelado"),
  ];
  it("preserva realizados e personalizados, não recria intervalos já realizados", () => {
    const p = replacementPreview(existing, "2026-09-28", [
      { dayOffset: 1, message: "novo D1" },
      { dayOffset: 7, message: "novo D7" },
      { dayOffset: 15, message: "novo D15" },
      { dayOffset: 60, message: "novo D60" },
    ]);
    expect(p.remove.map((s) => s.id)).toEqual(["d7", "d30"]);
    expect(p.preserve.map((s) => s.id)).toEqual(["d1", "d15"]);
    expect(p.add.map((s) => [s.dayOffset, s.dueDate])).toEqual([
      [7, "2026-10-05"],
      [60, "2026-11-27"],
    ]);
    expect(p.skipped).toEqual([1, 15]);
  });
});

describe("correção da data da consulta", () => {
  it("recalcula só pendentes não remarcadas; preserva realizadas e remarcadas", () => {
    const p = dateCorrectionPreview(
      [step("d0", 0, "realizado"), step("d7", 7, "pendente"), step("d15", 15, "pendente", { rescheduled: true }), step("d30", 30, "cancelado")],
      "2026-09-25",
    );
    expect(p.shift.map((s) => [s.id, s.dueDate, s.newDate])).toEqual([["d7", "2026-10-05", "2026-10-02"]]);
    expect(p.keepRescheduled.map((s) => s.id)).toEqual(["d15"]);
    expect(p.keepDone.map((s) => s.id)).toEqual(["d0"]);
  });
});

describe("status, central e variáveis", () => {
  const today = "2026-10-02";
  it("atrasado é calculado; hoje não está atrasado", () => {
    expect(isOverdue({ status: "pendente", dueDate: "2026-10-01" }, today)).toBe(true);
    expect(isOverdue({ status: "pendente", dueDate: today }, today)).toBe(false);
    expect(isOverdue({ status: "realizado", dueDate: "2026-09-01" }, today)).toBe(false);
  });
  const items: CentralItem[] = [
    { id: "1", status: "pendente", dueDate: "2026-09-30", doneAt: null, patientName: "Bia" },
    { id: "2", status: "pendente", dueDate: today, doneAt: null, patientName: "Ana" },
    { id: "3", status: "pendente", dueDate: "2026-10-09", doneAt: null, patientName: "Caio" },
    { id: "4", status: "realizado", dueDate: "2026-09-29", doneAt: "2026-09-29T10:00", patientName: "Ana" },
    { id: "5", status: "realizado", dueDate: "2026-09-20", doneAt: "2026-10-01T09:00", patientName: "Bia" },
    { id: "6", status: "cancelado", dueDate: "2026-09-25", doneAt: null, patientName: "Ana" },
    { id: "7", status: "pendente", dueDate: "2026-09-30", doneAt: null, patientName: "Ana" },
  ];
  it("contadores sobre todos, sem cancelados nem realizados", () => {
    expect(centralCounts(items, today)).toEqual({ hoje: 1, atrasados: 2, proximos: 1, concluidos: 2 });
  });
  it("filtros e ordenação estável", () => {
    const pick = (f: Parameters<typeof matchesCentralFilter>[1], canceled = false) =>
      sortCentral(items.filter((i) => matchesCentralFilter(i, f, today, canceled)), f).map((i) => i.id);
    expect(pick("hoje")).toEqual(["2"]);
    expect(pick("atrasados")).toEqual(["7", "1"]);
    expect(pick("proximos")).toEqual(["3"]);
    expect(pick("concluidos")).toEqual(["5", "4"]);
    expect(pick("todos")).toEqual(["5", "4", "7", "1", "2", "3"]);
    expect(pick("todos", true)).toContain("6");
  });
  it("variáveis com a etapa original mesmo remarcada", () => {
    expect(renderMessage("{dia_followup} de {nome} ({data_consulta})", { patientName: "Ana", consultDate: "2028-02-29", dayOffset: 7 })).toBe("D7 de Ana (29/02/2028)");
  });
});
