import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupFollowup, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import {
  cancelAppointment,
  confirmAppointment,
  listAppointmentsToConfirm,
  listPatientAppointments,
  listPlanDeadlines,
  rescheduleAppointment,
  scheduleAppointment,
  setPlanDeadline,
} from "./appointments-data";
import { createPatient, createTemplate, getPatient, listPatients, listTemplates, setPatientArchived, updateTemplate } from "./data";
import { needsAttention, planDeadline } from "./domain/deadline";
import { patientSchema, templateSchema } from "./domain/schemas";
import { createConsultationWithPlan, getPatientFollowups } from "./plans-data";

/** Bloco 5 no Neon real: duração, aviso de término e próxima consulta. Pacientes fictícios. */
const { A, B } = testUsers();
const patients: string[] = [];
const templates: string[] = [];
const today = todayInSaoPaulo();

afterAll(() => cleanupFollowup(patients, templates));

async function newPatient(name: string, user = A) {
  const r = await createPatient(user, patientSchema.parse({ name: `${TAG} ${name}`, phone: "", notes: "" }));
  const id = (r as { id: string }).id;
  patients.push(id);
  return id;
}
const steps = (offsets: number[]) => JSON.stringify(offsets.map((dayOffset) => ({ dayOffset, message: "Mensagem fictícia" })));
async function newTemplate(name: string, offsets: number[], durationDays: string, noticeDays: string, user = A) {
  const r = await createTemplate(user, templateSchema.parse({ name: `${TAG} ${name}`, description: "", steps: steps(offsets), durationDays, noticeDays }));
  const id = (r as { id: string }).id;
  templates.push(id);
  return id;
}
async function consult(patientId: string, consultDate: string, templateId: string | null, user = A) {
  const r = await createConsultationWithPlan(user, patientId, { consultDate, notes: null, requestId: randomUUID(), templateId });
  expect(r.ok).toBe(true);
  return (r as { id: string }).id;
}
const planOf = async (patientId: string, consultationId: string) => (await getPatientFollowups(A, patientId)).plans.find((p) => p.consultationId === consultationId)!;

describe("Follow-up: duração, aviso e próxima consulta (Neon real)", () => {
  it("validação do modelo: duração cobre a última etapa; aviso até a duração; nenhuma etapa é removida", () => {
    const base = { name: "X", description: "", steps: steps([1, 7, 30]) };
    expect(templateSchema.parse({ ...base, durationDays: "45", noticeDays: "7" })).toMatchObject({ durationDays: 45, noticeDays: 7 });
    expect(templateSchema.parse({ ...base, durationDays: "", noticeDays: "7" })).toMatchObject({ durationDays: null, noticeDays: null });
    const short = templateSchema.safeParse({ ...base, durationDays: "20", noticeDays: "7" });
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0]).toMatchObject({ path: ["durationDays"] });
    const notice = templateSchema.safeParse({ ...base, durationDays: "45", noticeDays: "46" });
    expect(notice.success).toBe(false);
    if (!notice.success) expect(notice.error.issues[0]).toMatchObject({ path: ["noticeDays"] });
    expect(templateSchema.safeParse({ ...base, durationDays: "45", noticeDays: "" }).success).toBe(false);
  });

  it("o plano copia duração e aviso do modelo; mudar o modelo depois não altera o plano", async () => {
    const tpl = await newTemplate("Com prazo", [1, 7, 30], "45", "7");
    expect((await listTemplates(A)).find((t) => t.id === tpl)).toMatchObject({ durationDays: 45, noticeDays: 7 });
    const patient = await newPatient("Prazo copiado");
    const consultDate = addDays(today, -10);
    const c = await consult(patient, consultDate, tpl);
    const plan = await planOf(patient, c);
    expect(plan).toMatchObject({ durationDays: 45, noticeDays: 7, status: "ativo" });
    // Data final: consulta (D0) + 45 dias.
    expect(planDeadline(consultDate, plan.durationDays, plan.noticeDays, today)).toEqual({ state: "em_acompanhamento", endDate: addDays(consultDate, 45), daysLeft: 35 });

    await updateTemplate(A, tpl, templateSchema.parse({ name: `${TAG} Com prazo`, description: "", steps: steps([1, 7, 30]), durationDays: "90", noticeDays: "14" }));
    expect((await listTemplates(A)).find((t) => t.id === tpl)).toMatchObject({ durationDays: 90, noticeDays: 14 });
    expect(await planOf(patient, c)).toMatchObject({ durationDays: 45, noticeDays: 7 });
    // As etapas continuam todas lá, pendentes.
    expect((await planOf(patient, c)).steps.map((s) => [s.dayOffset, s.status])).toEqual([
      [1, "pendente"],
      [7, "pendente"],
      [30, "pendente"],
    ]);
  });

  it("plano antigo sem duração: indicado como sem prazo; definir é explícito, validado e registrado", async () => {
    const tpl = await newTemplate("Sem prazo", [1, 7, 30], "", "");
    const patient = await newPatient("Sem prazo");
    const consultDate = addDays(today, -40);
    const c = await consult(patient, consultDate, tpl);
    const plan = await planOf(patient, c);
    expect(plan).toMatchObject({ durationDays: null, noticeDays: null });
    expect(planDeadline(consultDate, null, null, today).state).toBe("sem_prazo");
    expect((await listPlanDeadlines(A)).some((d) => d.planId === plan.id)).toBe(false);

    // Duração menor que a última etapa (D30): recusada, sem remover etapa.
    expect(await setPlanDeadline(A, plan.id, 20, 7)).toEqual({ ok: false, reason: "invalid_duration" });
    expect(await setPlanDeadline(B, plan.id, 45, 7)).toEqual({ ok: false, reason: "not_found" });
    expect(await setPlanDeadline(A, plan.id, 45, 7)).toMatchObject({ ok: true });
    expect(await setPlanDeadline(A, plan.id, 45, 7)).toEqual({ ok: false, reason: "nothing_to_do" });
    const after = await planOf(patient, c);
    expect(after).toMatchObject({ durationDays: 45, noticeDays: 7 });
    expect(after.steps.every((s) => s.status === "pendente")).toBe(true);
    // 40 dias depois da consulta, com aviso de 7: faltam 5 → perto de encerrar.
    expect(planDeadline(consultDate, 45, 7, today)).toMatchObject({ state: "perto_de_encerrar", daysLeft: 5 });
    const events = (await getPatientFollowups(A, patient)).events.filter((e) => e.action === "prazo_definido");
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ de: { duracao_dias: null }, para: { duracao_dias: 45, aviso_dias: 7 } });
  });

  it("aviso antes do fim, no último dia e depois; o fim do prazo não altera etapas", async () => {
    const tpl = await newTemplate("Avisos", [1], "10", "3");
    const patient = await newPatient("Avisos");
    const cases: Array<[number, string, number]> = [
      [-5, "em_acompanhamento", 5],
      [-7, "perto_de_encerrar", 3],
      [-10, "termina_hoje", 0],
      [-12, "encerrado", -2],
    ];
    for (const [daysAgo, state, daysLeft] of cases) {
      const consultDate = addDays(today, daysAgo);
      const c = await consult(patient, consultDate, tpl);
      const plan = await planOf(patient, c);
      expect(planDeadline(consultDate, plan.durationDays, plan.noticeDays, today)).toMatchObject({ state, daysLeft });
      // Prazo encerrado ou não, a etapa D1 continua pendente e o plano ativo.
      expect(plan.status).toBe("ativo");
      expect(plan.steps.map((s) => s.status)).toEqual(["pendente"]);
    }
    const mine = (await listPlanDeadlines(A)).filter((d) => d.patientId === patient);
    expect(mine).toHaveLength(4);
    expect(mine.every((d) => d.nextAppointment === null)).toBe(true);
    const states = mine.map((d) => planDeadline(d.consultDate, d.durationDays, d.noticeDays, today));
    expect(states.filter((d) => needsAttention(d, false))).toHaveLength(3);
    // B não vê os prazos de A.
    expect((await listPlanDeadlines(B)).some((d) => d.patientId === patient)).toBe(false);
  });

  it("próxima consulta: agendar, reagendar e cancelar; não é consulta realizada nem gera acompanhamento", async () => {
    const tpl = await newTemplate("Agenda", [1], "30", "7");
    const patient = await newPatient("Agenda");
    const c = await consult(patient, addDays(today, -25), tpl);
    const plan = await planOf(patient, c);
    expect((await getPatient(A, patient))?.patient.nextAppointment).toBeNull();
    const before = await getPatient(A, patient);

    const requestId = randomUUID();
    const future = addDays(today, 10);
    const [r1, r2] = await Promise.all([scheduleAppointment(A, patient, { date: future, time: "14:30", requestId }), scheduleAppointment(A, patient, { date: future, time: "14:30", requestId })]);
    expect(r1.ok || r2.ok).toBe(true);
    const open = (await listPatientAppointments(A, patient)).filter((a) => a.status === "agendada");
    expect(open).toHaveLength(1);
    // Vínculo com o paciente e com o acompanhamento de origem.
    expect(open[0]).toMatchObject({ patientId: patient, planId: plan.id, date: future, time: "14:30", consultationId: null });
    expect((await getPatient(A, patient))?.patient.nextAppointment).toEqual({ id: open[0].id, date: future, time: "14:30" });
    expect((await listPatients(A)).find((p) => p.id === patient)?.nextAppointment).toEqual({ id: open[0].id, date: future, time: "14:30" });
    // Nenhuma consulta nem plano novos.
    const after = await getPatient(A, patient);
    expect(after?.consultations).toHaveLength(before!.consultations.length);
    expect((await getPatientFollowups(A, patient)).plans).toHaveLength(1);
    // O aviso de término passa a mostrar a próxima consulta marcada.
    expect((await listPlanDeadlines(A)).find((d) => d.planId === plan.id)?.nextAppointment).toEqual({ date: future, time: "14:30" });

    // Só uma em aberto por paciente.
    expect(await scheduleAppointment(A, patient, { date: addDays(today, 20), time: null, requestId: randomUUID() })).toEqual({ ok: false, reason: "has_appointment" });
    // Reagendar (sem horário) e cancelar.
    expect(await rescheduleAppointment(A, open[0].id, { date: addDays(today, 15), time: null })).toMatchObject({ ok: true });
    expect(await rescheduleAppointment(A, open[0].id, { date: addDays(today, 15), time: null })).toEqual({ ok: false, reason: "nothing_to_do" });
    expect((await getPatient(A, patient))?.patient.nextAppointment).toEqual({ id: open[0].id, date: addDays(today, 15), time: null });
    // Confirmar antes da data não é possível.
    expect(await confirmAppointment(A, open[0].id, today)).toEqual({ ok: false, reason: "appointment_future" });
    expect(await cancelAppointment(A, open[0].id)).toMatchObject({ ok: true });
    expect((await getPatient(A, patient))?.patient.nextAppointment).toBeNull();
    expect(await rescheduleAppointment(A, open[0].id, { date: addDays(today, 16), time: null })).toEqual({ ok: false, reason: "appointment_closed" });
    expect(await cancelAppointment(A, open[0].id)).toEqual({ ok: false, reason: "appointment_closed" });
    // O acompanhamento não mudou com nada disso.
    expect(await planOf(patient, c)).toMatchObject({ status: "ativo", durationDays: 30 });
    const actions = (await getPatientFollowups(A, patient)).events.map((e) => e.action).filter((a) => a.startsWith("proxima_"));
    expect(actions).toEqual(["proxima_consulta_agendada", "proxima_consulta_reagendada", "proxima_consulta_cancelada"]);
    // Depois de cancelar, dá para agendar de novo.
    expect(await scheduleAppointment(A, patient, { date: addDays(today, 30), time: null, requestId: randomUUID() })).toMatchObject({ ok: true });
  });

  it("data agendada passou: pede confirmação; confirmar registra a consulta sem acompanhamento automático", async () => {
    const patient = await newPatient("Confirmação");
    const r = (await scheduleAppointment(A, patient, { date: today, time: "09:00", requestId: randomUUID() })) as { id: string };
    // Simula a passagem do tempo (o app só agenda de hoje em diante): a data vira ontem, pelo dono do banco.
    const yesterday = addDays(today, -1);
    const { Pool } = await import("@neondatabase/serverless");
    const owner = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
    try {
      await owner.query("update public.fu_appointments set scheduled_date = $2::date where id = $1", [r.id, yesterday]);
    } finally {
      await owner.end();
    }
    const pending = (await listAppointmentsToConfirm(A, today)).filter((a) => a.patientId === patient);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "agendada", date: yesterday });
    expect((await listAppointmentsToConfirm(B, today)).some((a) => a.patientId === patient)).toBe(false);
    // Nada foi confirmado sozinho.
    expect((await getPatient(A, patient))?.consultations).toHaveLength(0);

    expect(await confirmAppointment(B, r.id, today)).toEqual({ ok: false, reason: "not_found" });
    const confirmed = await confirmAppointment(A, r.id, today);
    expect(confirmed.ok).toBe(true);
    const detail = await getPatient(A, patient);
    expect(detail?.consultations.map((c) => c.consultDate)).toEqual([yesterday]);
    expect((await getPatientFollowups(A, patient)).plans).toHaveLength(0);
    const [done] = await listPatientAppointments(A, patient);
    expect(done).toMatchObject({ status: "realizada", consultationId: detail?.consultations[0].id });
    expect(await confirmAppointment(A, r.id, today)).toEqual({ ok: false, reason: "appointment_closed" });
    expect((await listAppointmentsToConfirm(A, today)).some((a) => a.patientId === patient)).toBe(false);
  });

  it("isolamento e permissões dos agendamentos", async () => {
    const patient = await newPatient("Isolado");
    const r = (await scheduleAppointment(A, patient, { date: addDays(today, 5), time: null, requestId: randomUUID() })) as { id: string };
    expect(await listPatientAppointments(B, patient)).toEqual([]);
    expect(await scheduleAppointment(B, patient, { date: addDays(today, 5), time: null, requestId: randomUUID() })).toEqual({ ok: false, reason: "not_found" });
    expect(await rescheduleAppointment(B, r.id, { date: addDays(today, 6), time: null })).toEqual({ ok: false, reason: "not_found" });
    expect(await cancelAppointment(B, r.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await asUser(null, "select id from public.fu_appointments")).toEqual([]);
    expect(await asUser(B.id, "select id from public.fu_appointments where id = $1", [r.id])).toEqual([]);
    await expect(asUser(B.id, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, current_date)", [A.id, patient])).rejects.toMatchObject({ code: "42501" });
    // B não agenda para paciente de A nem com o próprio user_id (chave estrangeira composta).
    await expect(asUser(B.id, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, current_date)", [B.id, patient])).rejects.toMatchObject({ code: "23503" });
    await expect(asUser(A.id, "update public.fu_appointments set patient_id = patient_id where id = $1", [r.id])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(A.id, "delete from public.fu_appointments where id = $1", [r.id])).rejects.toMatchObject({ code: "42501" });
    // Paciente arquivado não recebe agendamento novo.
    const archived = await newPatient("Arquivado");
    await setPatientArchived(A, archived, true);
    expect(await scheduleAppointment(A, archived, { date: addDays(today, 5), time: null, requestId: randomUUID() })).toEqual({ ok: false, reason: "patient_archived" });
  });
});
