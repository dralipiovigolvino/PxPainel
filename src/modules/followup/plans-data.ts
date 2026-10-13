import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { toFailure, type FailureReason, type MutationResult } from "./data";
import { renderMessage } from "./domain/messages";
import { buildSteps, dateCorrectionPreview, replacementPreview, type ExistingStep } from "./domain/plan";
import type { FuCentralStep, FuEvent, FuPlan, FuStep } from "./types";

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const STEP_COLUMNS = `s.id, s.plan_id, s.day_offset, s.message, s.custom_message,
  to_char(s.original_date, 'YYYY-MM-DD') as original_date, to_char(s.due_date, 'YYYY-MM-DD') as due_date,
  s.rescheduled_at is not null as rescheduled, s.status,
  to_char(s.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at, s.done_text, s.note,
  to_char(s.canceled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as canceled_at, s.cancel_kind, s.cancel_reason`;

type StepRow = {
  id: string;
  plan_id: string;
  day_offset: number;
  message: string;
  custom_message: string | null;
  original_date: string;
  due_date: string;
  rescheduled: boolean;
  status: FuStep["status"];
  done_at: string | null;
  done_text: string | null;
  note: string | null;
  canceled_at: string | null;
  cancel_kind: FuStep["cancelKind"];
  cancel_reason: string | null;
};

const mapStep = (r: StepRow): FuStep => ({
  id: r.id,
  planId: r.plan_id,
  dayOffset: r.day_offset,
  message: r.message,
  customMessage: r.custom_message,
  originalDate: r.original_date,
  dueDate: r.due_date,
  rescheduled: r.rescheduled,
  status: r.status,
  doneAt: r.done_at,
  doneText: r.done_text,
  note: r.note,
  canceledAt: r.canceled_at,
  cancelKind: r.cancel_kind,
  cancelReason: r.cancel_reason,
});

/** Planos (com etapas) e histórico de um paciente. */
export async function getPatientFollowups(user: AuthUser, patientId: string): Promise<{ plans: FuPlan[]; events: FuEvent[] }> {
  return withUserContext(user, async (db) => {
    const plans = await db.query<{
      id: string;
      consultation_id: string;
      patient_id: string;
      template_id: string | null;
      template_name: string;
      template_version: number;
      status: FuPlan["status"];
      canceled_at: string | null;
      cancel_reason: string | null;
      created_at: string;
      duration_days: number | null;
      notice_days: number | null;
    }>(
      `select id, consultation_id, patient_id, template_id, template_name, template_version, status, duration_days, notice_days,
              to_char(canceled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as canceled_at, cancel_reason,
              to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as created_at
         from public.fu_plans where patient_id = $1 order by fu_plans.created_at, id`,
      [patientId],
    );
    const steps = await db.query<StepRow>(
      `select ${STEP_COLUMNS} from public.fu_steps s join public.fu_plans p on p.id = s.plan_id
        where p.patient_id = $1 order by s.day_offset, s.created_at, s.id`,
      [patientId],
    );
    const events = await db.query<{ id: string; consultation_id: string | null; plan_id: string | null; step_id: string | null; action: string; details: Record<string, unknown>; created_at: string }>(
      `select id, consultation_id, plan_id, step_id, action, details,
              to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at
         from public.fu_events where patient_id = $1 order by fu_events.created_at, id`,
      [patientId],
    );
    const byPlan = new Map<string, FuStep[]>();
    for (const r of steps.rows) byPlan.set(r.plan_id, [...(byPlan.get(r.plan_id) ?? []), mapStep(r)]);
    return {
      plans: plans.rows.map((p) => ({
        id: p.id,
        consultationId: p.consultation_id,
        patientId: p.patient_id,
        templateId: p.template_id,
        templateName: p.template_name,
        templateVersion: p.template_version,
        status: p.status,
        canceledAt: p.canceled_at,
        cancelReason: p.cancel_reason,
        createdAt: p.created_at,
        durationDays: p.duration_days,
        noticeDays: p.notice_days,
        steps: byPlan.get(p.id) ?? [],
      })),
      events: events.rows.map((e) => ({
        id: e.id,
        consultationId: e.consultation_id,
        planId: e.plan_id,
        stepId: e.step_id,
        action: e.action,
        details: e.details,
        createdAt: e.created_at,
      })),
    };
  });
}

/** Todas as etapas (central). Volume de uso pessoal: filtros e contadores operam sobre o conjunto completo. */
export async function listCentralSteps(user: AuthUser): Promise<FuCentralStep[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<StepRow & { patient_id: string; patient_name: string; patient_archived: boolean; consultation_id: string; consult_date: string; plan_status: "ativo" | "cancelado" }>(
      `select ${STEP_COLUMNS}, p.patient_id, pt.name as patient_name, pt.archived_at is not null as patient_archived,
              p.consultation_id, to_char(c.consult_date, 'YYYY-MM-DD') as consult_date, p.status as plan_status
         from public.fu_steps s
         join public.fu_plans p on p.id = s.plan_id
         join public.fu_consultations c on c.id = p.consultation_id
         join public.fu_patients pt on pt.id = p.patient_id
        order by s.due_date, s.id`,
    );
    return rows.map((r) => ({
      ...mapStep(r),
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientArchived: r.patient_archived,
      consultationId: r.consultation_id,
      consultDate: r.consult_date,
      planStatus: r.plan_status,
    }));
  });
}

// ---------------------------------------------------------------------------
// Apoio às gravações
// ---------------------------------------------------------------------------

/** Interrompe a transação inteira (rollback) com um motivo de negócio. */
export class Abort extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
  }
}

export async function run(operation: string, user: AuthUser, fn: (db: PoolClient) => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await withUserContext(user, fn);
  } catch (error) {
    if (error instanceof Abort) return { ok: false, reason: error.reason };
    return toFailure(operation, error);
  }
}

type EventInput = { patientId: string; consultationId?: string | null; planId?: string | null; stepId?: string | null; action: string; details?: object };

export async function logEvent(db: PoolClient, userId: string, e: EventInput) {
  await db.query(
    "insert into public.fu_events (user_id, patient_id, consultation_id, plan_id, step_id, action, details) values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
    [userId, e.patientId, e.consultationId ?? null, e.planId ?? null, e.stepId ?? null, e.action, JSON.stringify(e.details ?? {})],
  );
}

type TemplateSnapshot = { id: string; name: string; version: number; durationDays: number | null; noticeDays: number | null; steps: Array<{ dayOffset: number; message: string }> };

/** Modelo ativo com etapas, travado para leitura (uma edição simultânea espera). */
async function loadTemplate(db: PoolClient, templateId: string): Promise<TemplateSnapshot | "not_found" | "template_archived" | "template_empty"> {
  const t = await db.query<{ id: string; name: string; version: number; archived: boolean; duration_days: number | null; notice_days: number | null }>(
    "select id, name, version, archived_at is not null as archived, duration_days, notice_days from public.fu_templates where id = $1 for share",
    [templateId],
  );
  if (!t.rows[0]) return "not_found";
  if (t.rows[0].archived) return "template_archived";
  const steps = await db.query<{ day_offset: number; message: string }>("select day_offset, message from public.fu_template_steps where template_id = $1 order by day_offset", [templateId]);
  if (steps.rows.length === 0) return "template_empty";
  const { id, name, version, duration_days, notice_days } = t.rows[0];
  return { id, name, version, durationDays: duration_days, noticeDays: notice_days, steps: steps.rows.map((s) => ({ dayOffset: s.day_offset, message: s.message })) };
}

async function insertSteps(db: PoolClient, userId: string, planId: string, steps: ReturnType<typeof buildSteps>) {
  for (const s of steps) {
    await db.query("insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, $3, $4, $5::date, $6::date)", [
      userId,
      planId,
      s.dayOffset,
      s.message,
      s.originalDate,
      s.dueDate,
    ]);
  }
}

type ConsultationRow = { id: string; patient_id: string; consult_date: string };

/** Consulta travada (serializa aplicação, substituição e correção de data da mesma consulta). */
async function lockConsultation(db: PoolClient, consultationId: string): Promise<ConsultationRow | null> {
  const { rows } = await db.query<ConsultationRow>(
    "select id, patient_id, to_char(consult_date, 'YYYY-MM-DD') as consult_date from public.fu_consultations where id = $1 for update",
    [consultationId],
  );
  return rows[0] ?? null;
}

async function createPlan(db: PoolClient, userId: string, consultation: ConsultationRow, template: TemplateSnapshot, requestId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    // Duração e aviso são COPIADOS do modelo: mudar o modelo depois não altera este plano.
    `insert into public.fu_plans (user_id, patient_id, consultation_id, template_id, template_name, template_version, request_id, duration_days, notice_days)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (user_id, request_id) do nothing returning id`,
    [userId, consultation.patient_id, consultation.id, template.id, template.name, template.version, requestId, template.durationDays, template.noticeDays],
  );
  if (!rows[0]) return null; // mesmo formulário reenviado: o plano já existe
  const steps = buildSteps(consultation.consult_date, template.steps);
  await insertSteps(db, userId, rows[0].id, steps);
  await logEvent(db, userId, {
    patientId: consultation.patient_id,
    consultationId: consultation.id,
    planId: rows[0].id,
    action: "plano_criado",
    details: { modelo: template.name, versao: template.version, etapas: steps.map((s) => s.dayOffset), duracao_dias: template.durationDays, aviso_dias: template.noticeDays },
  });
  return rows[0].id;
}

async function planForConsultation(db: PoolClient, consultationId: string) {
  const { rows } = await db.query<{ id: string; status: string; request_id: string; template_name: string; template_version: number }>(
    "select id, status, request_id, template_name, template_version from public.fu_plans where consultation_id = $1 for update",
    [consultationId],
  );
  return rows[0] ?? null;
}

async function existingSteps(db: PoolClient, planId: string): Promise<ExistingStep[]> {
  const { rows } = await db.query<StepRow>(`select ${STEP_COLUMNS} from public.fu_steps s where s.plan_id = $1 order by s.day_offset, s.id`, [planId]);
  return rows.map((r) => ({
    id: r.id,
    dayOffset: r.day_offset,
    status: r.status,
    dueDate: r.due_date,
    originalDate: r.original_date,
    rescheduled: r.rescheduled,
    customized: r.custom_message !== null,
  }));
}

// ---------------------------------------------------------------------------
// Consulta + plano
// ---------------------------------------------------------------------------

/**
 * Registra a consulta e, se escolhido, aplica o modelo NA MESMA transação.
 * Idempotente pelo requestId do formulário (duplo envio não cria outra consulta nem outro plano).
 */
export function createConsultationWithPlan(
  user: AuthUser,
  patientId: string,
  input: { consultDate: CivilDate; notes: string | null; requestId: string; templateId: string | null },
): Promise<MutationResult> {
  return run("consultation.create", user, async (db) => {
    const inserted = await db.query<{ id: string }>(
      `insert into public.fu_consultations (user_id, patient_id, consult_date, notes, request_id) values ($1, $2, $3::date, $4, $5)
       on conflict (user_id, request_id) where request_id is not null do nothing returning id`,
      [user.id, patientId, input.consultDate, input.notes, input.requestId],
    );
    if (!inserted.rows[0]) {
      const again = await db.query<{ id: string }>("select id from public.fu_consultations where request_id = $1", [input.requestId]);
      return again.rows[0] ? { ok: true, id: again.rows[0].id, count: 0 } : { ok: false, reason: "not_found" };
    }
    const consultation = { id: inserted.rows[0].id, patient_id: patientId, consult_date: input.consultDate };
    if (!input.templateId) return { ok: true, id: consultation.id, count: 0 };
    const template = await loadTemplate(db, input.templateId);
    // Modelo inválido: nada é gravado (nem a consulta), para não ficar consulta sem o plano pedido.
    if (typeof template === "string") throw new Abort(template);
    await createPlan(db, user.id, consultation, template, input.requestId);
    return { ok: true, id: consultation.id, count: template.steps.length };
  });
}

/** Escolhe um paciente existente ou cria paciente + consulta + plano na mesma transação. */
export function createCentralAttendance(
  user: AuthUser,
  patient: { id: string } | { name: string; phone: string | null },
  input: { consultDate: CivilDate; notes: string | null; requestId: string; templateId: string | null },
): Promise<MutationResult> {
  return run("consultation.central", user, async (db) => {
    let patientId: string;
    if ("id" in patient) patientId = patient.id;
    else {
      const created = await db.query<{ id: string }>("insert into public.fu_patients (user_id, name, phone, notes) values ($1, $2, $3, null) returning id", [user.id, patient.name, patient.phone]);
      patientId = created.rows[0].id;
    }
    const inserted = await db.query<{ id: string }>(
      `insert into public.fu_consultations (user_id, patient_id, consult_date, notes, request_id) values ($1, $2, $3::date, $4, $5)
       on conflict (user_id, request_id) where request_id is not null do nothing returning id`,
      [user.id, patientId, input.consultDate, input.notes, input.requestId],
    );
    if (!inserted.rows[0]) return { ok: true, count: 0 };
    const consultation = { id: inserted.rows[0].id, patient_id: patientId, consult_date: input.consultDate };
    if (!input.templateId) return { ok: true, id: consultation.id, count: 0 };
    const template = await loadTemplate(db, input.templateId);
    if (typeof template === "string") throw new Abort(template);
    await createPlan(db, user.id, consultation, template, input.requestId);
    return { ok: true, id: consultation.id, count: template.steps.length };
  });
}

/** Aplica um modelo a uma consulta ainda sem acompanhamento. Segunda aplicação não cria outro plano. */
export function applyTemplate(user: AuthUser, consultationId: string, templateId: string, requestId: string): Promise<MutationResult> {
  return run("plan.apply", user, async (db) => {
    const consultation = await lockConsultation(db, consultationId);
    if (!consultation) return { ok: false, reason: "not_found" };
    const current = await planForConsultation(db, consultationId);
    if (current) return current.request_id === requestId ? { ok: true, id: current.id, count: 0 } : { ok: false, reason: "has_plan" };
    const template = await loadTemplate(db, templateId);
    if (typeof template === "string") return { ok: false, reason: template };
    const planId = await createPlan(db, user.id, consultation, template, requestId);
    return { ok: true, id: planId ?? undefined, count: template.steps.length };
  });
}

export type ReplacementSummary = {
  remove: Array<{ dayOffset: number; dueDate: CivilDate }>;
  preserve: Array<{ dayOffset: number; dueDate: CivilDate; status: string; personalized: boolean }>;
  add: Array<{ dayOffset: number; dueDate: CivilDate; message: string }>;
  skipped: number[];
  templateName: string;
  templateVersion: number;
};

async function computeReplacement(db: PoolClient, consultationId: string, templateId: string) {
  const consultation = await lockConsultation(db, consultationId);
  if (!consultation) return { error: "not_found" as const };
  const plan = await planForConsultation(db, consultationId);
  if (!plan) return { error: "no_plan" as const };
  if (plan.status === "cancelado") return { error: "plan_canceled" as const };
  const template = await loadTemplate(db, templateId);
  if (typeof template === "string") return { error: template };
  const steps = await existingSteps(db, plan.id);
  return { consultation, plan, template, preview: replacementPreview(steps, consultation.consult_date, template.steps) };
}

const summarize = (p: ReturnType<typeof replacementPreview>, template: TemplateSnapshot): ReplacementSummary => ({
  remove: p.remove.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate })),
  preserve: p.preserve.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate, status: s.status, personalized: s.status === "pendente" })),
  add: p.add.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate, message: s.message })),
  skipped: p.skipped,
  templateName: template.name,
  templateVersion: template.version,
});

/** Prévia (somente leitura) da substituição das pendentes. */
export async function previewReplacement(user: AuthUser, consultationId: string, templateId: string): Promise<ReplacementSummary | { error: string }> {
  return withUserContext(user, async (db) => {
    const r = await computeReplacement(db, consultationId, templateId);
    return "error" in r ? { error: r.error! } : summarize(r.preview, r.template);
  });
}

/** Substitui as pendentes não personalizadas pelo modelo, preservando realizadas e personalizadas. */
export function replacePending(user: AuthUser, consultationId: string, templateId: string): Promise<MutationResult> {
  return run("plan.replace", user, async (db) => {
    const r = await computeReplacement(db, consultationId, templateId);
    if ("error" in r) return { ok: false, reason: r.error! };
    const { consultation, plan, template, preview } = r;
    if (preview.remove.length === 0 && preview.add.length === 0) return { ok: false, reason: "nothing_to_do" };
    for (const s of preview.remove) {
      await db.query("update public.fu_steps set status = 'cancelado', cancel_kind = 'substituido' where id = $1 and status = 'pendente'", [s.id]);
    }
    await insertSteps(db, user.id, plan.id, preview.add);
    await db.query("update public.fu_plans set template_id = $2, template_name = $3, template_version = $4 where id = $1", [plan.id, template.id, template.name, template.version]);
    await logEvent(db, user.id, {
      patientId: consultation.patient_id,
      consultationId,
      planId: plan.id,
      action: "plano_substituido",
      details: {
        de: { modelo: plan.template_name, versao: plan.template_version },
        para: { modelo: template.name, versao: template.version },
        removidas: preview.remove.map((s) => s.dayOffset),
        preservadas: preview.preserve.map((s) => s.dayOffset),
        incluidas: preview.add.map((s) => s.dayOffset),
      },
    });
    return { ok: true, id: plan.id, count: preview.add.length };
  });
}

// ---------------------------------------------------------------------------
// Correção da data da consulta
// ---------------------------------------------------------------------------

export type DateCorrectionSummary = {
  from: CivilDate;
  to: CivilDate;
  shift: Array<{ dayOffset: number; from: CivilDate; to: CivilDate }>;
  keepRescheduled: Array<{ dayOffset: number; dueDate: CivilDate }>;
  keepDone: Array<{ dayOffset: number; dueDate: CivilDate }>;
  hasPlan: boolean;
};

async function computeDateCorrection(db: PoolClient, consultationId: string, newDate: CivilDate) {
  const consultation = await lockConsultation(db, consultationId);
  if (!consultation) return null;
  const plan = await planForConsultation(db, consultationId);
  const steps = plan ? await existingSteps(db, plan.id) : [];
  return { consultation, plan, preview: dateCorrectionPreview(steps, newDate) };
}

export async function previewDateCorrection(user: AuthUser, consultationId: string, newDate: CivilDate): Promise<DateCorrectionSummary | null> {
  return withUserContext(user, async (db) => {
    const r = await computeDateCorrection(db, consultationId, newDate);
    if (!r) return null;
    return {
      from: r.consultation.consult_date,
      to: newDate,
      shift: r.preview.shift.map((s) => ({ dayOffset: s.dayOffset, from: s.dueDate, to: s.newDate })),
      keepRescheduled: r.preview.keepRescheduled.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate })),
      keepDone: r.preview.keepDone.map((s) => ({ dayOffset: s.dayOffset, dueDate: s.dueDate })),
      hasPlan: Boolean(r.plan),
    };
  });
}

/** Corrige a data e recalcula só as pendentes não remarcadas (após a confirmação na interface). */
export function correctConsultationDate(user: AuthUser, consultationId: string, newDate: CivilDate): Promise<MutationResult> {
  return run("consultation.date", user, async (db) => {
    const r = await computeDateCorrection(db, consultationId, newDate);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.consultation.consult_date === newDate) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.fu_consultations set consult_date = $2::date where id = $1", [consultationId, newDate]);
    for (const s of r.preview.shift) {
      await db.query("update public.fu_steps set original_date = $2::date, due_date = $2::date where id = $1 and status = 'pendente'", [s.id, s.newDate]);
    }
    await logEvent(db, user.id, {
      patientId: r.consultation.patient_id,
      consultationId,
      planId: r.plan?.id ?? null,
      action: "consulta_data_corrigida",
      details: {
        de: r.consultation.consult_date,
        para: newDate,
        recalculadas: r.preview.shift.map((s) => s.dayOffset),
        remarcadas_preservadas: r.preview.keepRescheduled.map((s) => s.dayOffset),
        realizadas_preservadas: r.preview.keepDone.map((s) => s.dayOffset),
      },
    });
    return { ok: true, id: consultationId, count: r.preview.shift.length };
  });
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

type StepContext = {
  id: string;
  status: FuStep["status"];
  day_offset: number;
  message: string;
  custom_message: string | null;
  due_date: string;
  original_date: string;
  done_at: string | null;
  done_text: string | null;
  plan_id: string;
  plan_status: string;
  patient_id: string;
  patient_name: string;
  consultation_id: string;
  consult_date: string;
};

/** Etapa com contexto, travando etapa e plano (serializa com substituição e correção). */
async function lockStep(db: PoolClient, stepId: string): Promise<StepContext | null> {
  const { rows } = await db.query<StepContext>(
    `select s.id, s.status, s.day_offset, s.message, s.custom_message, to_char(s.due_date, 'YYYY-MM-DD') as due_date,
            to_char(s.original_date, 'YYYY-MM-DD') as original_date, to_char(s.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at, s.done_text,
            s.plan_id, p.status as plan_status, p.patient_id, pt.name as patient_name, p.consultation_id,
            to_char(c.consult_date, 'YYYY-MM-DD') as consult_date
       from public.fu_steps s
       join public.fu_plans p on p.id = s.plan_id
       join public.fu_consultations c on c.id = p.consultation_id
       join public.fu_patients pt on pt.id = p.patient_id
      where s.id = $1
      for update of s, p`,
    [stepId],
  );
  return rows[0] ?? null;
}

const stepEvent = (s: StepContext, action: string, details: object): EventInput => ({
  patientId: s.patient_id,
  consultationId: s.consultation_id,
  planId: s.plan_id,
  stepId: s.id,
  action,
  details: { etapa: s.day_offset, ...details },
});

function withStep(operation: string, user: AuthUser, stepId: string, fn: (db: PoolClient, s: StepContext) => Promise<MutationResult>) {
  return run(operation, user, async (db) => {
    const s = await lockStep(db, stepId);
    if (!s) return { ok: false, reason: "not_found" };
    return fn(db, s);
  });
}

/** Texto final da etapa (ajuste ou cópia do modelo) com as variáveis do paciente e da consulta. */
const renderStep = (s: StepContext) => renderMessage(s.custom_message ?? s.message, { patientName: s.patient_name, consultDate: s.consult_date, dayOffset: s.day_offset });

export function rescheduleStep(user: AuthUser, stepId: string, newDate: CivilDate) {
  return withStep("step.reschedule", user, stepId, async (db, s) => {
    if (s.status !== "pendente") return { ok: false, reason: "step_locked" };
    if (s.plan_status !== "ativo") return { ok: false, reason: "plan_canceled" };
    if (newDate === s.due_date) return { ok: false, reason: "nothing_to_do" };
    if (newDate < s.consult_date) return { ok: false, reason: "invalid_date" };
    // Voltar para a data original desfaz a marcação de remarcada.
    await db.query(
      "update public.fu_steps set due_date = $2::date, rescheduled_at = case when $2::date = original_date then null else now() end where id = $1",
      [s.id, newDate],
    );
    await logEvent(db, user.id, stepEvent(s, "etapa_remarcada", { de: s.due_date, para: newDate, data_original: s.original_date }));
    return { ok: true, id: s.id };
  });
}

/** Ajuste do texto só desta etapa pendente (null = volta ao texto copiado do modelo). */
export function saveStepMessage(user: AuthUser, stepId: string, text: string | null) {
  return withStep("step.message", user, stepId, async (db, s) => {
    if (s.status !== "pendente") return { ok: false, reason: "step_locked" };
    const value = text === null || text === s.message ? null : text;
    await db.query("update public.fu_steps set custom_message = $2 where id = $1", [s.id, value]);
    await logEvent(db, user.id, stepEvent(s, "mensagem_ajustada", { restaurada: value === null }));
    return { ok: true, id: s.id };
  });
}

/** Realizada: guarda o instante (servidor) e o texto renderizado naquele momento. Não afirma envio. */
export function markStepDone(user: AuthUser, stepId: string, note: string | null) {
  return withStep("step.done", user, stepId, async (db, s) => {
    if (s.status !== "pendente") return { ok: false, reason: "step_locked" };
    if (s.plan_status !== "ativo") return { ok: false, reason: "plan_canceled" };
    await db.query("update public.fu_steps set status = 'realizado', done_text = $2, note = coalesce($3, note) where id = $1", [s.id, renderStep(s), note]);
    await logEvent(db, user.id, stepEvent(s, "etapa_realizada", { prevista: s.due_date, com_observacao: note !== null }));
    return { ok: true, id: s.id };
  });
}

/** Desfaz uma realização marcada por engano; o registro anterior fica no histórico. */
export function undoStepDone(user: AuthUser, stepId: string) {
  return withStep("step.undo", user, stepId, async (db, s) => {
    if (s.status !== "realizado") return { ok: false, reason: "step_locked" };
    await db.query("update public.fu_steps set status = 'pendente' where id = $1", [s.id]);
    await logEvent(db, user.id, stepEvent(s, "etapa_desfeita", { realizada_em: s.done_at, texto_registrado: s.done_text }));
    return { ok: true, id: s.id };
  });
}

export function cancelStep(user: AuthUser, stepId: string, reason: string | null) {
  return withStep("step.cancel", user, stepId, async (db, s) => {
    if (s.status !== "pendente") return { ok: false, reason: "step_locked" };
    await db.query("update public.fu_steps set status = 'cancelado', cancel_kind = 'cancelado', cancel_reason = $2 where id = $1", [s.id, reason]);
    await logEvent(db, user.id, stepEvent(s, "etapa_cancelada", { motivo_informado: reason !== null }));
    return { ok: true, id: s.id };
  });
}

/** Observação da etapa (pendente ou realizada). */
export function saveStepNote(user: AuthUser, stepId: string, note: string | null) {
  return withStep("step.note", user, stepId, async (db, s) => {
    if (s.status === "cancelado") return { ok: false, reason: "step_locked" };
    await db.query("update public.fu_steps set note = $2 where id = $1", [s.id, note]);
    await logEvent(db, user.id, stepEvent(s, "observacao_registrada", { removida: note === null }));
    return { ok: true, id: s.id };
  });
}

/** "Mensagem copiada" (só registro; não marca realizado nem comprova envio). */
export function logStepCopied(user: AuthUser, stepId: string) {
  return withStep("step.copied", user, stepId, async (db, s) => {
    if (s.status === "cancelado") return { ok: false, reason: "step_locked" };
    await logEvent(db, user.id, stepEvent(s, "mensagem_copiada", {}));
    return { ok: true, id: s.id };
  });
}

/** Cancela o acompanhamento: pendentes canceladas; realizadas preservadas. */
export function cancelPlan(user: AuthUser, planId: string, reason: string | null) {
  return run("plan.cancel", user, async (db) => {
    const { rows } = await db.query<{ id: string; status: string; patient_id: string; consultation_id: string }>(
      "select id, status, patient_id, consultation_id from public.fu_plans where id = $1 for update",
      [planId],
    );
    const plan = rows[0];
    if (!plan) return { ok: false, reason: "not_found" };
    if (plan.status === "cancelado") return { ok: false, reason: "plan_canceled" };
    await db.query("update public.fu_plans set status = 'cancelado', cancel_reason = $2 where id = $1", [planId, reason]);
    const canceled = await db.query(
      "update public.fu_steps set status = 'cancelado', cancel_kind = 'cancelado', cancel_reason = $2 where plan_id = $1 and status = 'pendente'",
      [planId, reason],
    );
    await logEvent(db, user.id, {
      patientId: plan.patient_id,
      consultationId: plan.consultation_id,
      planId,
      action: "plano_cancelado",
      details: { pendentes_canceladas: canceled.rowCount ?? 0, motivo_informado: reason !== null },
    });
    return { ok: true, id: planId, count: canceled.rowCount ?? 0 };
  });
}
