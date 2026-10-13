import { describe, expect, it } from "vitest";
import { describeHours, durationMinutes, endDate, overlapping, parseHours } from "./hours";
import { seriesSchema, shiftSchema, typeSchema } from "./schemas";

describe("horários de plantão", () => {
  it("aceita mesmo dia, noturno, 12 h e 24 h", () => {
    expect(parseHours("07:00", "19:00", false)).toEqual({ ok: true, hours: { start: "07:00", end: "19:00", nextDay: false } });
    const night = parseHours("19:00", "07:00", true);
    expect(night.ok && durationMinutes(night.hours!)).toBe(720);
    const day24 = parseHours("07:00", "07:00", true);
    expect(day24.ok && durationMinutes(day24.hours!)).toBe(1440);
    expect(parseHours("", "", false)).toEqual({ ok: true, hours: null });
  });
  it("recusa horários incompletos, zero ou acima de 24 h", () => {
    expect(parseHours("07:00", "", false)).toMatchObject({ ok: false, field: "end" });
    expect(parseHours("", "19:00", false)).toMatchObject({ ok: false, field: "start" });
    expect(parseHours("07:00", "07:00", false)).toMatchObject({ ok: false, field: "end" });
    expect(parseHours("19:00", "07:00", false)).toMatchObject({ ok: false, field: "end" });
    expect(parseHours("07:00", "08:00", true)).toMatchObject({ ok: false, field: "nextDay" });
    expect(parseHours("7h", "19:00", false)).toMatchObject({ ok: false, field: "start" });
    expect(parseHours("24:00", "19:00", false)).toMatchObject({ ok: false, field: "start" });
  });
  it("descreve horários e data de término (atravessa a meia-noite, inclusive virada de ano)", () => {
    expect(describeHours({ start: "19:00", end: "07:00", nextDay: true }, "2026-12-31")).toBe("19:00 → 07:00 do dia 01/01/2027 (12 h)");
    expect(describeHours({ start: "07:00", end: "07:00", nextDay: true })).toBe("07:00 → 07:00 do dia seguinte (24 h)");
    expect(describeHours({ start: "08:30", end: "12:00", nextDay: false })).toBe("08:30 → 12:00 (3 h 30)");
    expect(describeHours(null)).toBe("Sem horário definido");
    expect(endDate("2028-02-28", { start: "19:00", end: "07:00", nextDay: true })).toBe("2028-02-29");
    expect(endDate("2026-10-05", null)).toBe("2026-10-05");
  });
  it("sobreposição considera o noturno do dia anterior; sem horário não entra", () => {
    const night = { id: "n", date: "2026-10-05", hours: { start: "19:00", end: "07:00", nextDay: true } };
    const morning = { id: "m", date: "2026-10-06", hours: { start: "06:00", end: "12:00", nextDay: false } };
    const later = { id: "l", date: "2026-10-06", hours: { start: "07:00", end: "19:00", nextDay: false } };
    const free = { id: "f", date: "2026-10-06", hours: null };
    expect(overlapping(morning, [night, later, free]).map((s) => s.id)).toEqual(["n", "l"]);
    expect(overlapping(later, [night]).map((s) => s.id)).toEqual([]);
    expect(overlapping(free, [night, later])).toEqual([]);
  });
});

describe("validações", () => {
  it("tipo: valor positivo em centavos, cor, horários e observação padrão", () => {
    expect(typeSchema.parse({ name: " Hospital  A ", location: "", amount: "1.200,50", color: "#2563EB", notes: "", start: "19:00", end: "07:00", nextDay: "true", cnpjId: "", payDay: "" })).toEqual({
      name: "Hospital A",
      location: null,
      amount: 120050,
      cnpjId: null,
      payDay: null,
      payMonthOffset: 1,
      color: "#2563eb",
      notes: null,
      hours: { start: "19:00", end: "07:00", nextDay: true },
    });
    const bad = typeSchema.safeParse({ name: "", location: "", amount: "0", color: "azul", notes: "", start: "07:00", end: "", nextDay: "false", cnpjId: "", payDay: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0]).sort()).toEqual(["amount", "color", "name"]);
  });
  it("recebo por CNPJ: vazio = sem CNPJ; marcado = o id do CNPJ", () => {
    const CNPJ = "00000000-0000-4000-8000-0000000000a1";
    const shift = { date: "2026-10-05", amount: "800", notes: "", start: "", end: "", nextDay: "false", payMode: "auto", payDate: "" };
    expect(shiftSchema.parse({ ...shift, cnpjId: "" }).cnpjId).toBeNull();
    expect(shiftSchema.parse({ ...shift, cnpjId: CNPJ }).cnpjId).toBe(CNPJ);
    const bad = shiftSchema.safeParse({ ...shift, cnpjId: "sim" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0])).toEqual(["cnpjId"]);
  });
  it("ocorrência: data válida e valor editável", () => {
    expect(shiftSchema.parse({ date: "2026-10-05", amount: "800", notes: "Troca com colega", start: "", end: "", nextDay: "false", cnpjId: "", payMode: "auto", payDate: "" })).toMatchObject({ amount: 80000, hours: null });
    expect(shiftSchema.safeParse({ date: "2026-02-30", amount: "800", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payMode: "auto", payDate: "" }).success).toBe(false);
  });
});

describe("recorrência (formulário)", () => {
  const base = { weekdays: ["4"], intervalWeeks: "1", startDate: "2026-10-01", until: "", amount: "1.000,00", notes: "", start: "19:00", end: "07:00", nextDay: "true", cnpjId: "" };
  it("aceita toda quinta, semanas alternadas e data final", () => {
    expect(seriesSchema.parse(base)).toMatchObject({ weekdays: [4], intervalWeeks: 1, endDate: null, amount: 100000, hours: { nextDay: true } });
    expect(seriesSchema.parse({ ...base, weekdays: ["4", "1", "4"], intervalWeeks: "2", until: "2026-12-31" })).toMatchObject({ weekdays: [1, 4], intervalWeeks: 2, endDate: "2026-12-31" });
  });
  it("recusa sem dias, intervalo fora de 1–12 e data final antes da inicial", () => {
    const r = seriesSchema.safeParse({ ...base, weekdays: [], intervalWeeks: "13", until: "2026-09-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["intervalWeeks", "until", "weekdays"]);
    expect(seriesSchema.safeParse({ ...base, weekdays: ["7"] }).success).toBe(false);
  });
});
