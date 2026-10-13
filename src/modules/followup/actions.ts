"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFreshUser } from "@/lib/auth/session";
import type { ActionState } from "@/modules/financas/actions";
import { isUuid } from "@/modules/financas/domain/filters";
import {
  createPatient,
  createTemplate,
  deletePatient,
  setPatientArchived,
  setTemplateArchived,
  updateConsultationNotes,
  updatePatient,
  updateTemplate,
  type FailureReason,
  type MutationResult,
} from "./data";
import { parseCivilDate, todayInSaoPaulo } from "@/lib/dates";
import {
  applyTemplate,
  cancelPlan,
  cancelStep,
  correctConsultationDate,
  createCentralAttendance,
  createConsultationWithPlan,
  logStepCopied,
  markStepDone,
  previewDateCorrection,
  previewReplacement,
  replacePending,
  rescheduleStep,
  saveStepMessage,
  saveStepNote,
  undoStepDone,
  type DateCorrectionSummary,
  type ReplacementSummary,
} from "./plans-data";
import { cancelAppointment, confirmAppointment, rescheduleAppointment, scheduleAppointment, setPlanDeadline } from "./appointments-data";
import { messageError, normalizeMessage } from "./domain/messages";
import { CONSULT_NOTES_MAX, REASON_MAX, STEP_NOTE_MAX, consultDateSchema, appointmentSchema, consultationSchema, fieldErrors, notesField, patientSchema, planDeadlineSchema, templateSchema } from "./domain/schemas";

export type { ActionState } from "@/modules/financas/actions";

const FAILURES: Record<FailureReason, string> = {
  not_found: "Registro não encontrado. Atualize a página.",
  duplicate_name: "Já existe um modelo com esse nome.",
  patient_archived: "O paciente está arquivado. Restaure-o para registrar novas consultas.",
  consult_future: "A consulta não pode ter data futura.",
  has_consultations: "Este paciente tem consultas e não pode ser excluído. Arquive-o em vez disso.",
  template_archived: "O modelo está arquivado. Restaure-o ou escolha outro.",
  template_empty: "O modelo precisa de pelo menos uma etapa.",
  has_plan: "Esta consulta já tem acompanhamento. Use \"Substituir pendentes\" para trocar as etapas.",
  no_plan: "Esta consulta ainda não tem acompanhamento.",
  plan_canceled: "Este acompanhamento foi cancelado e não pode ser alterado.",
  step_locked: "Esta etapa não pode mais ser alterada (realizada ou cancelada). Atualize a página.",
  nothing_to_do: "Nada a alterar.",
  invalid_date: "A data não pode ser anterior à consulta.",
  has_appointment: "Este paciente já tem uma próxima consulta agendada. Use \"Reagendar\" para mudar a data.",
  appointment_closed: "Este agendamento já foi confirmado ou cancelado. Atualize a página.",
  appointment_future: "Só é possível confirmar o atendimento na data agendada ou depois dela.",
  invalid_duration: "A duração precisa cobrir a última etapa do acompanhamento, e o aviso não pode ser maior que a duração.",
  error: "Não foi possível salvar agora. Tente novamente.",
};

const FIELD_FOR: Partial<Record<FailureReason, string>> = {
  duplicate_name: "name",
  consult_future: "consultDate",
  template_archived: "templateId",
  template_empty: "templateId",
  invalid_date: "dueDate",
  invalid_duration: "durationDays",
  has_appointment: "date",
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** Resultado → estado do formulário. Mensagens nunca repetem dados do paciente. */
async function finish(result: MutationResult, message: string, values?: Record<string, string>): Promise<ActionState> {
  if (!result.ok) {
    const field = FIELD_FOR[result.reason];
    return { status: "error", message: FAILURES[result.reason], fieldErrors: field ? { [field]: FAILURES[result.reason] } : undefined, values };
  }
  revalidatePath("/follow-up", "layout");
  revalidatePath("/"); // o dashboard lê os mesmos registros
  return { status: "success", message, nonce: Date.now() };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

const invalidId = (): ActionState => ({ status: "error", message: "Registro inválido. Atualize a página." });

// --- Pacientes ---------------------------------------------------------------

export async function savePatientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), phone: text(formData, "phone"), notes: text(formData, "notes") };
  const parsed = patientSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await updatePatient(user, id, parsed.data), "Paciente atualizado.", values);
  }
  return finish(await createPatient(user, parsed.data), "Paciente cadastrado.", values);
}

export async function archivePatientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  const result = await setPatientArchived(user, id, archive);
  const pending = result.ok ? (result.count ?? 0) : 0;
  const message = archive
    ? pending > 0
      ? `Paciente arquivado. ${pending === 1 ? "1 etapa pendente continua" : `${pending} etapas pendentes continuam`} em Acompanhamentos.`
      : "Paciente arquivado."
    : "Paciente restaurado.";
  return finish(result, message);
}

export async function deletePatientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const result = await finish(await deletePatient(user, id), "Paciente excluído.");
  // A página do paciente deixa de existir: volta para a lista (o aviso vai por código, sem dados).
  if (result.status === "success") redirect("/follow-up/pacientes?aviso=paciente-excluido");
  return result;
}

// --- Consultas ---------------------------------------------------------------

export async function saveConsultationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const patientId = text(formData, "patientId");
  const requestId = text(formData, "requestId");
  const templateId = text(formData, "templateId");
  if (!isUuid(patientId) || !isUuid(requestId) || (templateId !== "" && !isUuid(templateId))) return invalidId();
  const values = { consultDate: text(formData, "consultDate"), notes: text(formData, "notes"), templateId };
  const parsed = consultationSchema(todayInSaoPaulo()).safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  const result = await createConsultationWithPlan(user, patientId, { ...parsed.data, requestId, templateId: templateId || null });
  const steps = result.ok ? (result.count ?? 0) : 0;
  return finish(result, steps > 0 ? `Consulta registrada com acompanhamento (${plural(steps, "etapa", "etapas")}).` : "Consulta registrada.", values);
}

export async function saveCentralAttendanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const mode = text(formData, "patientMode");
  const patientId = text(formData, "patientId");
  const requestId = text(formData, "requestId");
  const templateId = text(formData, "templateId");
  const values = { patientMode: mode, patientId, name: text(formData, "name"), phone: text(formData, "phone"), consultDate: text(formData, "consultDate"), notes: text(formData, "notes"), templateId };
  if (!isUuid(requestId) || (templateId !== "" && !isUuid(templateId))) return invalidId();
  const consultation = consultationSchema(todayInSaoPaulo()).safeParse(values);
  if (!consultation.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(consultation.error), values };
  let patient: { id: string } | { name: string; phone: string | null };
  if (mode === "new") {
    const parsed = patientSchema.safeParse({ name: values.name, phone: values.phone, notes: "" });
    if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
    patient = { name: parsed.data.name, phone: parsed.data.phone };
  } else {
    if (!isUuid(patientId)) return { status: "error", message: "Escolha o paciente.", fieldErrors: { patientId: "Escolha o paciente." }, values };
    patient = { id: patientId };
  }
  const result = await createCentralAttendance(user, patient, { ...consultation.data, requestId, templateId: templateId || null });
  const steps = result.ok ? result.count ?? 0 : 0;
  return finish(result, steps ? `Atendimento registrado com acompanhamento (${plural(steps, "etapa", "etapas")}).` : "Atendimento registrado.", values);
}

/** Aplica um modelo a uma consulta sem acompanhamento. */
export async function applyTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const consultationId = text(formData, "consultationId");
  const templateId = text(formData, "templateId");
  const requestId = text(formData, "requestId");
  if (!isUuid(consultationId) || !isUuid(requestId)) return invalidId();
  if (!isUuid(templateId)) return { status: "error", message: "Escolha um modelo.", fieldErrors: { templateId: "Escolha um modelo." } };
  const result = await applyTemplate(user, consultationId, templateId, requestId);
  const steps = result.ok ? (result.count ?? 0) : 0;
  return finish(result, steps > 0 ? `Acompanhamento gerado (${plural(steps, "etapa", "etapas")}).` : "Acompanhamento gerado.");
}

/** Prévia da substituição (somente leitura). */
export async function previewReplacementAction(consultationId: string, templateId: string): Promise<ReplacementSummary | { error: string }> {
  const user = await requireFreshUser();
  if (!isUuid(consultationId) || !isUuid(templateId)) return { error: FAILURES.not_found };
  const r = await previewReplacement(user, consultationId, templateId);
  return "error" in r ? { error: FAILURES[r.error as FailureReason] ?? FAILURES.error } : r;
}

export async function replacePendingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const consultationId = text(formData, "consultationId");
  const templateId = text(formData, "templateId");
  if (!isUuid(consultationId) || !isUuid(templateId)) return invalidId();
  return finish(await replacePending(user, consultationId, templateId), "Etapas pendentes substituídas. Realizadas e personalizadas foram mantidas.");
}

/** Prévia do impacto da correção de data (somente leitura). */
export async function previewDateCorrectionAction(consultationId: string, newDate: string): Promise<DateCorrectionSummary | { error: string } | null> {
  const user = await requireFreshUser();
  if (!isUuid(consultationId)) return null;
  const parsed = consultDateSchema(todayInSaoPaulo()).safeParse(newDate);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return previewDateCorrection(user, consultationId, parsed.data);
}

export async function consultationDateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { consultDate: text(formData, "consultDate") };
  const parsed = consultDateSchema(todayInSaoPaulo()).safeParse(values.consultDate);
  if (!parsed.success) return { status: "error", message: "Revise a data.", fieldErrors: { consultDate: parsed.error.issues[0].message }, values };
  const result = await correctConsultationDate(user, id, parsed.data);
  const shifted = result.ok ? (result.count ?? 0) : 0;
  return finish(
    result,
    shifted > 0 ? `Data corrigida. ${plural(shifted, "etapa pendente recalculada", "etapas pendentes recalculadas")}.` : "Data da consulta corrigida.",
    values,
  );
}

export async function consultationNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { notes: text(formData, "notes") };
  const parsed = notesField(CONSULT_NOTES_MAX).safeParse(values.notes);
  if (!parsed.success) return { status: "error", message: "Revise a observação.", fieldErrors: { notes: parsed.error.issues[0].message }, values };
  return finish(await updateConsultationNotes(user, id, parsed.data), "Observação da consulta salva.", values);
}

// --- Modelos -----------------------------------------------------------------

export async function saveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), description: text(formData, "description"), steps: text(formData, "steps"), durationDays: text(formData, "durationDays"), noticeDays: text(formData, "noticeDays") };
  const parsed = templateSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await updateTemplate(user, id, parsed.data), "Modelo atualizado. Acompanhamentos já gerados não mudam.", values);
  }
  return finish(await createTemplate(user, parsed.data), "Modelo criado.", values);
}

export async function archiveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  return finish(await setTemplateArchived(user, id, archive), archive ? "Modelo arquivado. Acompanhamentos já gerados não mudam." : "Modelo restaurado.");
}

// --- Prazo e próxima consulta --------------------------------------------------

/** Define ou altera a duração e o aviso de um acompanhamento existente (explícito; registrado no histórico). */
export async function planDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const planId = text(formData, "planId");
  if (!isUuid(planId)) return invalidId();
  const values = { durationDays: text(formData, "durationDays"), noticeDays: text(formData, "noticeDays") };
  const parsed = planDeadlineSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  return finish(await setPlanDeadline(user, planId, parsed.data.durationDays, parsed.data.noticeDays), "Prazo do acompanhamento salvo. As etapas não foram alteradas.", values);
}

/** Agenda (sem id) ou reagenda (com id) a próxima consulta. Não registra consulta nem gera acompanhamento. */
export async function appointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const patientId = text(formData, "patientId");
  const requestId = text(formData, "requestId");
  const values = { date: text(formData, "date"), time: text(formData, "time") };
  const parsed = appointmentSchema(todayInSaoPaulo()).safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await rescheduleAppointment(user, id, parsed.data), "Próxima consulta reagendada.", values);
  }
  if (!isUuid(patientId) || !isUuid(requestId)) return invalidId();
  return finish(await scheduleAppointment(user, patientId, { ...parsed.data, requestId }), "Próxima consulta agendada. Ela não conta como consulta realizada.", values);
}

export async function cancelAppointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  return finish(await cancelAppointment(user, id), "Agendamento cancelado. O acompanhamento não foi alterado.");
}

export async function confirmAppointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  return finish(await confirmAppointment(user, id, todayInSaoPaulo()), "Atendimento confirmado: a consulta foi registrada. Se quiser, gere um novo acompanhamento a partir dela.");
}

// --- Etapas e planos ---------------------------------------------------------

function idOf(formData: FormData): string | null {
  const id = text(formData, "id");
  return isUuid(id) ? id : null;
}

export async function rescheduleStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  const values = { dueDate: text(formData, "dueDate").trim() };
  if (!parseCivilDate(values.dueDate) || values.dueDate > "2100-12-31") return { status: "error", message: "Revise a data.", fieldErrors: { dueDate: "Data inválida." }, values };
  return finish(await rescheduleStep(user, id, values.dueDate), "Etapa remarcada. A data original continua registrada.", values);
}

export async function stepMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  if (text(formData, "reset") === "true") return finish(await saveStepMessage(user, id, null), "Texto da etapa voltou ao do modelo.");
  const values = { message: text(formData, "message") };
  const message = normalizeMessage(values.message);
  const error = messageError(message);
  if (error) return { status: "error", message: "Revise a mensagem.", fieldErrors: { message: error }, values };
  return finish(await saveStepMessage(user, id, message), "Texto desta etapa ajustado. O modelo não mudou.", values);
}

export async function stepDoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  const values = { note: text(formData, "note") };
  const parsed = notesField(STEP_NOTE_MAX).safeParse(values.note);
  if (!parsed.success) return { status: "error", message: "Revise a observação.", fieldErrors: { note: parsed.error.issues[0].message }, values };
  return finish(await markStepDone(user, id, parsed.data), "Etapa marcada como realizada.", values);
}

export async function undoStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  return finish(await undoStepDone(user, id), "Realização desfeita. A etapa voltou para pendente; o registro anterior ficou no histórico.");
}

export async function stepNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  const values = { note: text(formData, "note") };
  const parsed = notesField(STEP_NOTE_MAX).safeParse(values.note);
  if (!parsed.success) return { status: "error", message: "Revise a observação.", fieldErrors: { note: parsed.error.issues[0].message }, values };
  return finish(await saveStepNote(user, id, parsed.data), parsed.data ? "Observação registrada." : "Observação removida.", values);
}

function reasonOf(formData: FormData): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = text(formData, "reason").trim().replace(/\s+/g, " ");
  if (raw === "") return { ok: true, value: null };
  if ([...raw].length > REASON_MAX) return { ok: false, error: `Use no máximo ${REASON_MAX} caracteres.` };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: "O motivo contém caracteres inválidos." };
  return { ok: true, value: raw };
}

export async function cancelStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  const reason = reasonOf(formData);
  if (!reason.ok) return { status: "error", message: reason.error, fieldErrors: { reason: reason.error } };
  return finish(await cancelStep(user, id, reason.value), "Etapa cancelada. Ela continua visível no histórico.");
}

export async function cancelPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = idOf(formData);
  if (!id) return invalidId();
  const reason = reasonOf(formData);
  if (!reason.ok) return { status: "error", message: reason.error, fieldErrors: { reason: reason.error } };
  const result = await cancelPlan(user, id, reason.value);
  const n = result.ok ? (result.count ?? 0) : 0;
  return finish(result, `Acompanhamento cancelado (${plural(n, "etapa pendente cancelada", "etapas pendentes canceladas")}). Realizadas foram mantidas.`);
}

/** Registro "mensagem copiada" (não marca realizado). Devolve só se foi registrado. */
export async function logCopiedAction(id: string): Promise<boolean> {
  const user = await requireFreshUser();
  if (!isUuid(id)) return false;
  return (await logStepCopied(user, id)).ok;
}
