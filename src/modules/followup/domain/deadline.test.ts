import { describe, expect, it } from "vitest";
import { checkDuration, describeDeadline, describeNextAppointment, endDateOf, needsAppointmentConfirmation, needsAttention, planDeadline } from "./deadline";

describe("prazo do acompanhamento", () => {
  it("a consulta é D0: 45 dias terminam 45 dias depois", () => {
    expect(endDateOf("2026-10-04", 45)).toBe("2026-11-18");
    expect(endDateOf("2026-12-20", 45)).toBe("2027-02-03"); // virada de ano
  });

  it("estados: antes do aviso, no período de aviso, no último dia e depois", () => {
    const d = (today: string) => planDeadline("2026-10-04", 45, 7, today);
    expect(d("2026-11-10")).toEqual({ state: "em_acompanhamento", endDate: "2026-11-18", daysLeft: 8 });
    expect(d("2026-11-11")).toEqual({ state: "perto_de_encerrar", endDate: "2026-11-18", daysLeft: 7 });
    expect(d("2026-11-17")).toEqual({ state: "perto_de_encerrar", endDate: "2026-11-18", daysLeft: 1 });
    expect(d("2026-11-18")).toEqual({ state: "termina_hoje", endDate: "2026-11-18", daysLeft: 0 });
    expect(d("2026-11-19")).toEqual({ state: "encerrado", endDate: "2026-11-18", daysLeft: -1 });
  });

  it("aviso de 0 dias só avisa no último dia; sem duração não presume prazo", () => {
    expect(planDeadline("2026-10-04", 10, 0, "2026-10-13").state).toBe("em_acompanhamento");
    expect(planDeadline("2026-10-04", 10, 0, "2026-10-14").state).toBe("termina_hoje");
    expect(planDeadline("2026-10-04", null, null, "2026-10-14")).toEqual({ state: "sem_prazo", endDate: null, daysLeft: null });
  });

  it("textos com data de término e dias restantes", () => {
    expect(describeDeadline(planDeadline("2026-10-04", 45, 7, "2026-11-06"))).toBe("Termina em 18/11/2026 (faltam 12 dias)");
    expect(describeDeadline(planDeadline("2026-10-04", 45, 7, "2026-11-17"))).toBe("Termina em 18/11/2026 (falta 1 dia)");
    expect(describeDeadline(planDeadline("2026-10-04", 45, 7, "2026-11-18"))).toBe("Termina hoje (18/11/2026)");
    expect(describeDeadline(planDeadline("2026-10-04", 45, 7, "2026-11-21"))).toBe("Encerrado em 18/11/2026 (há 3 dias)");
  });

  it("coerência entre duração, etapas e aviso (nenhuma etapa é removida)", () => {
    expect(checkDuration(45, 7, [1, 7, 15, 30])).toEqual({ ok: true });
    expect(checkDuration(30, 7, [1, 7, 30])).toEqual({ ok: true });
    expect(checkDuration(20, 7, [1, 7, 30])).toMatchObject({ ok: false, field: "durationDays" });
    expect(checkDuration(45, 46, [1])).toMatchObject({ ok: false, field: "noticeDays" });
    expect(checkDuration(0, 0, [])).toMatchObject({ ok: false, field: "durationDays" });
    expect(checkDuration(3651, 7, [])).toMatchObject({ ok: false, field: "durationDays" });
    expect(checkDuration(45, -1, [])).toMatchObject({ ok: false, field: "noticeDays" });
  });

  it("próxima consulta: textos e confirmação pendente", () => {
    expect(describeNextAppointment(null)).toBe("Próxima consulta não agendada");
    expect(describeNextAppointment({ date: "2026-11-20", time: null })).toBe("Próxima consulta: 20/11/2026");
    expect(describeNextAppointment({ date: "2026-11-20", time: "14:30" })).toBe("Próxima consulta: 20/11/2026 às 14:30");
    expect(needsAppointmentConfirmation({ status: "agendada", date: "2026-10-03" }, "2026-10-04")).toBe(true);
    expect(needsAppointmentConfirmation({ status: "agendada", date: "2026-10-04" }, "2026-10-04")).toBe(false);
    expect(needsAppointmentConfirmation({ status: "cancelada", date: "2026-10-03" }, "2026-10-04")).toBe(false);
  });

  it("destaque: perto de encerrar ou encerrado, sem próxima consulta", () => {
    const near = planDeadline("2026-10-04", 45, 7, "2026-11-15");
    expect(needsAttention(near, false)).toBe(true);
    expect(needsAttention(near, true)).toBe(false);
    expect(needsAttention(planDeadline("2026-10-04", 45, 7, "2026-10-10"), false)).toBe(false);
    expect(needsAttention(planDeadline("2026-10-04", null, null, "2026-10-10"), false)).toBe(false);
  });
});
