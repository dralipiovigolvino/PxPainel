import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupFollowup, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import { randomUUID } from "node:crypto";
import {
  createPatient,
  createTemplate,
  deletePatient,
  getPatient,
  listPatients,
  listTemplates,
  setPatientArchived,
  setTemplateArchived,
  updateConsultationNotes,
  updatePatient,
  updateTemplate,
} from "./data";
import { patientSchema, templateSchema } from "./domain/schemas";
import { correctConsultationDate, createCentralAttendance, createConsultationWithPlan } from "./plans-data";

const createConsultation = (user: typeof A, patientId: string, input: { consultDate: string; notes: string | null }) =>
  createConsultationWithPlan(user, patientId, { ...input, requestId: randomUUID(), templateId: null });
const updateConsultationDate = correctConsultationDate;

/** Etapa 8 no Neon real, com o código do servidor e o papel do app. Somente dados fictícios. */
const { A, B } = testUsers();
const patients: string[] = [];
const templates: string[] = [];
const today = todayInSaoPaulo();

afterAll(() => cleanupFollowup(patients, templates));

async function newPatient(name: string, phone = "", user = A): Promise<string> {
  const r = await createPatient(user, patientSchema.parse({ name: `${TAG} ${name}`, phone, notes: "" }));
  expect(r.ok).toBe(true);
  const id = (r as { id: string }).id;
  patients.push(id);
  return id;
}

describe("Etapa 8 — pacientes, consultas e modelos (Neon real)", () => {
  it("central cria paciente + atendimento atomicamente ou usa paciente existente, com isolamento", async () => {
    const name = `${TAG} Atendimento central`;
    expect(await createCentralAttendance(A, { name, phone: "+5511999999999" }, { consultDate: today, notes: "Cadastro conjunto", requestId: randomUUID(), templateId: null })).toMatchObject({ ok: true });
    const created = (await listPatients(A)).find((p) => p.name === name)!;
    patients.push(created.id);
    expect((await getPatient(A, created.id))?.consultations).toHaveLength(1);
    expect(await createCentralAttendance(A, { id: created.id }, { consultDate: today, notes: "Paciente existente", requestId: randomUUID(), templateId: null })).toMatchObject({ ok: true });
    expect((await getPatient(A, created.id))?.consultations).toHaveLength(2);
    expect(await createCentralAttendance(B, { id: created.id }, { consultDate: today, notes: null, requestId: randomUUID(), templateId: null })).toEqual({ ok: false, reason: "not_found" });
    const rollbackName = `${TAG} Atendimento rollback`;
    expect(await createCentralAttendance(A, { name: rollbackName, phone: null }, { consultDate: today, notes: null, requestId: randomUUID(), templateId: randomUUID() })).toEqual({ ok: false, reason: "not_found" });
    expect((await listPatients(A)).some((p) => p.name === rollbackName)).toBe(false);
  });
  it("nomes iguais são pacientes diferentes; telefone vazio ou normalizado", async () => {
    const p1 = await newPatient("Ana Souza");
    const p2 = await newPatient("Ana Souza", "(11) 98765-4321");
    expect(p1).not.toBe(p2);
    const list = (await listPatients(A)).filter((p) => p.name === `${TAG} Ana Souza`);
    expect(list.map((p) => p.phone).sort()).toEqual(["+5511987654321", null].sort());
  });

  it("editar, arquivar (bloqueia consulta nova) e restaurar", async () => {
    const id = await newPatient("Bruno");
    expect(await updatePatient(A, id, patientSchema.parse({ name: `${TAG} Bruno Lima`, phone: "+1 415 555 2671", notes: "Prefere manhã" }))).toMatchObject({ ok: true });
    expect((await getPatient(A, id))!.patient).toMatchObject({ name: `${TAG} Bruno Lima`, phone: "+14155552671", notes: "Prefere manhã" });
    expect(await setPatientArchived(A, id, true)).toMatchObject({ ok: true, count: 0 });
    expect(await createConsultation(A, id, { consultDate: today, notes: null })).toEqual({ ok: false, reason: "patient_archived" });
    expect(await setPatientArchived(A, id, false)).toMatchObject({ ok: true });
    expect(await createConsultation(A, id, { consultDate: today, notes: null })).toMatchObject({ ok: true });
  });

  it("várias consultas sem sobrescrever; retroativa sim, futura não (banco)", async () => {
    const id = await newPatient("Carla");
    expect(await createConsultation(A, id, { consultDate: "2026-01-10", notes: "Primeira" })).toMatchObject({ ok: true });
    expect(await createConsultation(A, id, { consultDate: "2026-03-05", notes: null })).toMatchObject({ ok: true });
    expect(await createConsultation(A, id, { consultDate: addDays(today, 1), notes: null })).toEqual({ ok: false, reason: "consult_future" });
    const detail = (await getPatient(A, id))!;
    expect(detail.consultations.map((c) => [c.consultDate, c.notes])).toEqual([
      ["2026-03-05", null],
      ["2026-01-10", "Primeira"],
    ]);
    expect(detail.patient).toMatchObject({ consultationCount: 2, lastConsultDate: "2026-03-05" });
    const first = detail.consultations[1];
    expect(await updateConsultationNotes(A, first.id, "Primeira, revisada")).toMatchObject({ ok: true });
    expect(await updateConsultationDate(A, first.id, "2026-01-12")).toMatchObject({ ok: true });
    expect(await updateConsultationDate(A, first.id, addDays(today, 3))).toEqual({ ok: false, reason: "consult_future" });
    expect((await getPatient(A, id))!.consultations[1]).toMatchObject({ consultDate: "2026-01-12", notes: "Primeira, revisada" });
    // Com consultas, não exclui; sem consultas, exclui.
    expect(await deletePatient(A, id)).toEqual({ ok: false, reason: "has_consultations" });
    const empty = await newPatient("Sem consultas");
    expect(await deletePatient(A, empty)).toEqual({ ok: true, id: undefined });
  });

  it("modelos com intervalos personalizados; duplicado recusado; nova versão ao editar", async () => {
    const input = templateSchema.parse({
      name: `${TAG} Pós-operatório`,
      description: "",
      steps: JSON.stringify([
        { dayOffset: 0, message: "Olá, {nome}." },
        { dayOffset: 2, message: "Como está? ({dia_followup})" },
        { dayOffset: 45, message: "Retorno da consulta de {data_consulta}." },
      ]),
    });
    const r = await createTemplate(A, input);
    expect(r.ok).toBe(true);
    const id = (r as { id: string }).id;
    templates.push(id);
    expect(await createTemplate(A, { ...input })).toEqual({ ok: false, reason: "duplicate_name" });
    expect(await updateTemplate(A, id, { ...input, steps: [{ dayOffset: 3, message: "Só uma" }] })).toMatchObject({ ok: true });
    const t = (await listTemplates(A)).find((x) => x.id === id)!;
    expect(t).toMatchObject({ version: 2, steps: [{ dayOffset: 3, message: "Só uma", position: 0 }] });
    expect(await setTemplateArchived(A, id, true)).toMatchObject({ ok: true });
    expect(await setTemplateArchived(A, id, false)).toMatchObject({ ok: true });
    // O banco também recusa intervalo duplicado e fora do limite, mesmo sem a validação do app.
    const dup = await asUser(A.id, "insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, 3, 'x', 1)", [A.id, id]).catch((e) => e.code);
    expect(dup).toBe("23505");
    const big = await asUser(A.id, "insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, 3651, 'x', 2)", [A.id, id]).catch((e) => e.code);
    expect(big).toBe("23514");
  });

  it("isolamento: B não lê, não altera e não vincula consulta a paciente de A", async () => {
    const id = await newPatient("Isolado");
    expect(await getPatient(B, id)).toBeNull();
    expect((await listPatients(B)).some((p) => p.id === id)).toBe(false);
    expect(await updatePatient(B, id, patientSchema.parse({ name: "Invasor", phone: "", notes: "" }))).toEqual({ ok: false, reason: "not_found" });
    expect(await setPatientArchived(B, id, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await deletePatient(B, id)).toEqual({ ok: false, reason: "not_found" });
    expect(await createConsultation(B, id, { consultDate: today, notes: null })).toEqual({ ok: false, reason: "not_found" });
    const tpl = templates[0];
    expect((await listTemplates(B)).some((t) => t.id === tpl)).toBe(false);
    expect(await updateTemplate(B, tpl, templateSchema.parse({ name: "X", description: "", steps: JSON.stringify([{ dayOffset: 1, message: "x" }]) }))).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect((await getPatient(A, id))!.patient.name).toBe(`${TAG} Isolado`);
  });
});
