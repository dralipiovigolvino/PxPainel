import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupFollowup, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import { createPatient, createTemplate, getPatient, setTemplateArchived, updateTemplate } from "./data";
import { isOverdue } from "./domain/plan";
import { patientSchema, templateSchema } from "./domain/schemas";
import {
  applyTemplate,
  cancelPlan,
  cancelStep,
  correctConsultationDate,
  createConsultationWithPlan,
  getPatientFollowups,
  listCentralSteps,
  logStepCopied,
  markStepDone,
  previewDateCorrection,
  previewReplacement,
  replacePending,
  rescheduleStep,
  saveStepMessage,
  undoStepDone,
} from "./plans-data";

/** Etapa 9 no Neon real (código do servidor + papel do app). Pacientes e textos fictícios. */
const { A, B } = testUsers();
const patients: string[] = [];
const templates: string[] = [];
const today = todayInSaoPaulo();
let tpl = "";

afterAll(() => cleanupFollowup(patients, templates));

async function newPatient(name: string, user = A) {
  const r = await createPatient(user, patientSchema.parse({ name: `${TAG} ${name}`, phone: "", notes: "" }));
  const id = (r as { id: string }).id;
  patients.push(id);
  return id;
}
async function newTemplate(name: string, steps: Array<[number, string]>, user = A) {
  const r = await createTemplate(user, templateSchema.parse({ name: `${TAG} ${name}`, description: "", steps: JSON.stringify(steps.map(([dayOffset, message]) => ({ dayOffset, message }))) }));
  const id = (r as { id: string }).id;
  templates.push(id);
  return id;
}
async function consult(patientId: string, consultDate: string, templateId: string | null = tpl, user = A) {
  const r = await createConsultationWithPlan(user, patientId, { consultDate, notes: null, requestId: randomUUID(), templateId });
  expect(r.ok).toBe(true);
  return (r as { id: string }).id;
}
const planOf = async (patientId: string, consultationId: string, user = A) => (await getPatientFollowups(user, patientId)).plans.find((p) => p.consultationId === consultationId)!;
const stepAt = async (patientId: string, consultationId: string, offset: number) => (await planOf(patientId, consultationId)).steps.find((s) => s.dayOffset === offset && s.status !== "cancelado")!;

beforeAll(async () => {
  tpl = await newTemplate("Padrão", [
    [0, "Olá, {nome}! Consulta de {data_consulta}."],
    [1, "{dia_followup}: como passou a noite, {nome}?"],
    [7, "Uma semana depois ({dia_followup})."],
    [30, "Um mês após {data_consulta}."],
  ]);
}, 60_000);

describe("Etapa 9 — geração e execução (Neon real)", () => {
  it("aplica o modelo: datas por dias corridos; retroativa gera atrasados", async () => {
    const p = await newPatient("Retroativa");
    const base = addDays(today, -10);
    const c = await consult(p, base);
    const plan = await planOf(p, c);
    expect(plan).toMatchObject({ status: "ativo", templateName: `${TAG} Padrão`, templateVersion: 1 });
    expect(plan.steps.map((s) => [s.dayOffset, s.dueDate, s.originalDate, s.status])).toEqual([
      [0, base, base, "pendente"],
      [1, addDays(base, 1), addDays(base, 1), "pendente"],
      [7, addDays(base, 7), addDays(base, 7), "pendente"],
      [30, addDays(base, 30), addDays(base, 30), "pendente"],
    ]);
    expect(plan.steps.filter((s) => isOverdue(s, today)).map((s) => s.dayOffset)).toEqual([0, 1, 7]);
    // Cópia do texto do modelo (com variáveis) — editar o modelo depois não muda o plano.
    await updateTemplate(A, tpl, templateSchema.parse({ name: `${TAG} Padrão`, description: "", steps: JSON.stringify([{ dayOffset: 2, message: "Outro texto" }]) }));
    const after = await planOf(p, c);
    expect(after.steps.map((s) => s.message)).toEqual(plan.steps.map((s) => s.message));
    expect(after.templateVersion).toBe(1);
    // Restaura o modelo para os próximos testes (versão 3).
    await updateTemplate(A, tpl, templateSchema.parse({
      name: `${TAG} Padrão`,
      description: "",
      steps: JSON.stringify([
        { dayOffset: 0, message: "Olá, {nome}! Consulta de {data_consulta}." },
        { dayOffset: 1, message: "{dia_followup}: como passou a noite, {nome}?" },
        { dayOffset: 7, message: "Uma semana depois ({dia_followup})." },
        { dayOffset: 30, message: "Um mês após {data_consulta}." },
      ]),
    }));
  });

  it("duplo envio e concorrência não duplicam consulta nem plano", async () => {
    const p = await newPatient("Duplo envio");
    const requestId = randomUUID();
    const input = { consultDate: today, notes: null, requestId, templateId: tpl };
    const [r1, r2] = await Promise.all([createConsultationWithPlan(A, p, input), createConsultationWithPlan(A, p, input)]);
    expect(r1.ok && r2.ok).toBe(true);
    const detail = (await getPatient(A, p))!;
    expect(detail.consultations.length).toBe(1);
    expect((await getPatientFollowups(A, p)).plans.length).toBe(1);
    expect((await planOf(p, detail.consultations[0].id)).steps.length).toBe(4);

    // Mesma consulta sem plano, duas aplicações simultâneas com formulários diferentes: só uma gera.
    const c = await consult(p, addDays(today, -1), null);
    const results = await Promise.all([applyTemplate(A, c, tpl, randomUUID()), applyTemplate(A, c, tpl, randomUUID())]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.reason)).toEqual(["has_plan"]);
    expect((await planOf(p, c)).steps.length).toBe(4);
    // Reaplicar depois também não cria outro plano.
    expect(await applyTemplate(A, c, tpl, randomUUID())).toEqual({ ok: false, reason: "has_plan" });
  });

  it("modelo inválido não grava a consulta (transação inteira); arquivado não é aplicado", async () => {
    const p = await newPatient("Modelo arquivado");
    const archived = await newTemplate("Arquivado", [[3, "x"]]);
    await setTemplateArchived(A, archived, true);
    expect(await createConsultationWithPlan(A, p, { consultDate: today, notes: null, requestId: randomUUID(), templateId: archived })).toEqual({
      ok: false,
      reason: "template_archived",
    });
    expect((await getPatient(A, p))!.consultations.length).toBe(0);
  });

  it("copiar não conclui; realizar guarda instante e texto; desfazer preserva o registro", async () => {
    const p = await newPatient("Maria Fictícia");
    const c = await consult(p, addDays(today, -2));
    const d1 = await stepAt(p, c, 1);
    expect(await logStepCopied(A, d1.id)).toMatchObject({ ok: true });
    expect((await stepAt(p, c, 1)).status).toBe("pendente");
    expect(await markStepDone(A, d1.id, "Respondeu bem (fictício).")).toMatchObject({ ok: true });
    const done = await stepAt(p, c, 1);
    expect(done).toMatchObject({ status: "realizado", doneText: `D1: como passou a noite, ${TAG} Maria Fictícia?`, note: "Respondeu bem (fictício)." });
    expect(done.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(await markStepDone(A, d1.id, null)).toEqual({ ok: false, reason: "step_locked" });
    expect(await undoStepDone(A, d1.id)).toMatchObject({ ok: true });
    expect(await stepAt(p, c, 1)).toMatchObject({ status: "pendente", doneAt: null, doneText: null, note: "Respondeu bem (fictício)." });
    const events = (await getPatientFollowups(A, p)).events.map((e) => [e.action, e.details]);
    expect(events.map(([a]) => a)).toEqual(["plano_criado", "mensagem_copiada", "etapa_realizada", "etapa_desfeita"]);
    expect(events[3][1]).toMatchObject({ etapa: 1, texto_registrado: done.doneText });
  });

  it("ajuste de texto só da etapa e remarcação individual (data original guardada)", async () => {
    const p = await newPatient("Ajustes");
    const c = await consult(p, addDays(today, -3));
    const d7 = await stepAt(p, c, 7);
    expect(await saveStepMessage(A, d7.id, "Texto só desta etapa, {nome}.")).toMatchObject({ ok: true });
    expect(await rescheduleStep(A, d7.id, addDays(d7.dueDate, 2))).toMatchObject({ ok: true });
    expect(await rescheduleStep(A, d7.id, addDays(today, -30))).toEqual({ ok: false, reason: "invalid_date" });
    expect(await stepAt(p, c, 7)).toMatchObject({ customMessage: "Texto só desta etapa, {nome}.", dueDate: addDays(d7.dueDate, 2), originalDate: d7.originalDate, rescheduled: true, message: d7.message });
    await markStepDone(A, d7.id, null);
    expect((await stepAt(p, c, 7)).doneText).toBe(`Texto só desta etapa, ${TAG} Ajustes.`);
  });

  it("corrigir a data da consulta: prévia, recalcula só pendentes não remarcadas, preserva realizadas", async () => {
    const p = await newPatient("Correção");
    const base = addDays(today, -5);
    const c = await consult(p, base);
    const d0 = await stepAt(p, c, 0);
    const d7 = await stepAt(p, c, 7);
    await markStepDone(A, d0.id, null);
    await rescheduleStep(A, d7.id, addDays(today, 10));
    const newDate = addDays(base, -2);
    const preview = (await previewDateCorrection(A, c, newDate))!;
    expect(preview).toMatchObject({
      from: base,
      to: newDate,
      shift: [
        { dayOffset: 1, from: addDays(base, 1), to: addDays(newDate, 1) },
        { dayOffset: 30, from: addDays(base, 30), to: addDays(newDate, 30) },
      ],
      keepRescheduled: [{ dayOffset: 7, dueDate: addDays(today, 10) }],
      keepDone: [{ dayOffset: 0 }],
    });
    // A prévia não altera nada.
    expect((await stepAt(p, c, 1)).dueDate).toBe(addDays(base, 1));
    expect(await correctConsultationDate(A, c, newDate)).toMatchObject({ ok: true, count: 2 });
    const plan = await planOf(p, c);
    expect(plan.steps.map((s) => [s.dayOffset, s.status, s.dueDate])).toEqual([
      [0, "realizado", base],
      [1, "pendente", addDays(newDate, 1)],
      [7, "pendente", addDays(today, 10)],
      [30, "pendente", addDays(newDate, 30)],
    ]);
    const ev = (await getPatientFollowups(A, p)).events.find((e) => e.action === "consulta_data_corrigida")!;
    expect(ev.details).toMatchObject({ de: base, para: newDate, recalculadas: [1, 30], remarcadas_preservadas: [7], realizadas_preservadas: [0] });
  });

  it("substituir pendentes: preserva realizadas e personalizadas, sem duplicar intervalos", async () => {
    const p = await newPatient("Substituição");
    const base = addDays(today, -1);
    const c = await consult(p, base);
    await markStepDone(A, (await stepAt(p, c, 1)).id, null);
    await saveStepMessage(A, (await stepAt(p, c, 7)).id, "Personalizada.");
    const other = await newTemplate("Novo", [
      [1, "novo D1"],
      [7, "novo D7"],
      [15, "novo D15"],
    ]);
    const preview = await previewReplacement(A, c, other);
    expect(preview).toMatchObject({
      remove: [{ dayOffset: 0 }, { dayOffset: 30 }],
      preserve: [{ dayOffset: 1, status: "realizado" }, { dayOffset: 7, status: "pendente" }],
      add: [{ dayOffset: 15, dueDate: addDays(base, 15) }],
      skipped: [1, 7],
    });
    expect(await replacePending(A, c, other)).toMatchObject({ ok: true, count: 1 });
    const plan = await planOf(p, c);
    expect(plan).toMatchObject({ templateName: `${TAG} Novo`, templateVersion: 1 });
    const alive = plan.steps.filter((s) => s.status !== "cancelado").map((s) => [s.dayOffset, s.status, s.customMessage ?? s.message]);
    expect(alive).toEqual([
      [1, "realizado", "{dia_followup}: como passou a noite, {nome}?"],
      [7, "pendente", "Personalizada."],
      [15, "pendente", "novo D15"],
    ]);
    expect(plan.steps.filter((s) => s.cancelKind === "substituido").map((s) => s.dayOffset)).toEqual([0, 30]);
    // Intervalos vivos únicos (garantido também por índice parcial no banco).
    const offsets = alive.map(([o]) => o);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it("conferência: D7 pendente comum é substituída por nova D7 (histórico preservado); D7 personalizada é mantida e aparece na prévia", async () => {
    const original = await newTemplate("Conferência original", [
      [1, "Original D1"],
      [7, "Original D7"],
    ]);
    const updated = await newTemplate("Conferência nova", [
      [1, "Nova D1"],
      [7, "Nova D7 com mensagem atualizada"],
      [15, "Nova D15"],
    ]);
    // Caso 1: D7 pendente comum.
    const p = await newPatient("Conferência D7");
    const base = addDays(today, -2);
    const c = await consult(p, base, original);
    await markStepDone(A, (await stepAt(p, c, 1)).id, null);
    const oldD7 = await stepAt(p, c, 7);
    const preview = await previewReplacement(A, c, updated);
    expect(preview).toMatchObject({
      remove: [{ dayOffset: 7 }],
      preserve: [{ dayOffset: 1, status: "realizado" }],
      add: [{ dayOffset: 7, message: "Nova D7 com mensagem atualizada" }, { dayOffset: 15 }],
      skipped: [1],
    });
    expect(await replacePending(A, c, updated)).toMatchObject({ ok: true, count: 2 });
    const plan = await planOf(p, c);
    expect(plan.steps.map((s) => [s.dayOffset, s.status, s.cancelKind, s.message])).toEqual([
      [1, "realizado", null, "Original D1"],
      [7, "cancelado", "substituido", "Original D7"],
      [7, "pendente", null, "Nova D7 com mensagem atualizada"],
      [15, "pendente", null, "Nova D15"],
    ]);
    expect(plan.steps.find((s) => s.id === oldD7.id)).toMatchObject({ status: "cancelado", cancelKind: "substituido" });
    expect((await stepAt(p, c, 7)).dueDate).toBe(addDays(base, 7));

    // Caso 2: D7 personalizada (texto ajustado) é preservada e listada como mantida/não recriada.
    const p2 = await newPatient("Conferência D7 personalizada");
    const c2 = await consult(p2, base, original);
    await saveStepMessage(A, (await stepAt(p2, c2, 7)).id, "Texto ajustado.");
    const preview2 = await previewReplacement(A, c2, updated);
    expect(preview2).toMatchObject({
      remove: [{ dayOffset: 1 }],
      preserve: [{ dayOffset: 7, status: "pendente", personalized: true }],
      add: [{ dayOffset: 1 }, { dayOffset: 15 }],
      skipped: [7],
    });
  });

  it("cancelar etapa e plano: realizadas preservadas; cancelado é final", async () => {
    const p = await newPatient("Cancelamento");
    const c = await consult(p, addDays(today, -1));
    await markStepDone(A, (await stepAt(p, c, 0)).id, null);
    const d1 = await stepAt(p, c, 1);
    expect(await cancelStep(A, d1.id, "Paciente pediu para não contatar (fictício)")).toMatchObject({ ok: true });
    expect(await markStepDone(A, d1.id, null)).toEqual({ ok: false, reason: "step_locked" });
    const plan = await planOf(p, c);
    expect(await cancelPlan(A, plan.id, null)).toMatchObject({ ok: true, count: 2 });
    const after = await planOf(p, c);
    expect(after.status).toBe("cancelado");
    expect(after.steps.map((s) => [s.dayOffset, s.status])).toEqual([
      [0, "realizado"],
      [1, "cancelado"],
      [7, "cancelado"],
      [30, "cancelado"],
    ]);
    expect(await cancelPlan(A, plan.id, null)).toEqual({ ok: false, reason: "plan_canceled" });
    expect(await replacePending(A, c, tpl)).toEqual({ ok: false, reason: "plan_canceled" });
    expect(await undoStepDone(A, after.steps[0].id)).toEqual({ ok: false, reason: "plan_canceled" });
  });

  it("duas consultas do mesmo paciente: planos e históricos independentes", async () => {
    const p = await newPatient("Duas consultas");
    const c1 = await consult(p, addDays(today, -20));
    const c2 = await consult(p, addDays(today, -2));
    await markStepDone(A, (await stepAt(p, c1, 0)).id, null);
    const f = await getPatientFollowups(A, p);
    expect(f.plans.length).toBe(2);
    expect((await planOf(p, c1)).steps.filter((s) => s.status === "realizado").length).toBe(1);
    expect((await planOf(p, c2)).steps.every((s) => s.status === "pendente")).toBe(true);
    expect(new Set(f.events.filter((e) => e.action === "plano_criado").map((e) => e.consultationId))).toEqual(new Set([c1, c2]));
  });

  it("isolamento: B não lê, não altera e não aplica nada de A", async () => {
    const p = await newPatient("Isolamento");
    const c = await consult(p, addDays(today, -1));
    const step = await stepAt(p, c, 0);
    const pB = await newPatient("Paciente de B", B);
    const cB = await consult(pB, today, null, B);
    expect(await applyTemplate(B, cB, tpl, randomUUID())).toEqual({ ok: false, reason: "not_found" });
    expect(await applyTemplate(B, c, tpl, randomUUID())).toEqual({ ok: false, reason: "not_found" });
    expect(await markStepDone(B, step.id, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await cancelPlan(B, step.planId, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await correctConsultationDate(B, c, addDays(today, -3))).toEqual({ ok: false, reason: "not_found" });
    expect(await getPatientFollowups(B, p)).toEqual({ plans: [], events: [] });
    expect((await listCentralSteps(B)).some((s) => s.patientId === p)).toBe(false);
    expect(await createConsultationWithPlan(B, p, { consultDate: today, notes: null, requestId: randomUUID(), templateId: null })).toEqual({ ok: false, reason: "not_found" });
    expect((await stepAt(p, c, 0)).status).toBe("pendente");
    // SQL direto como B: histórico de A invisível; não insere etapa no plano de A.
    expect((await asUser<{ n: number }>(B.id, "select count(*)::int as n from public.fu_events where patient_id = $1", [p]))[0].n).toBe(0);
    const forged = await asUser(B.id, "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, 99, 'x', current_date, current_date)", [B.id, step.planId]).catch((e) => e.code);
    expect(forged).toBe("23503");
  });
});
