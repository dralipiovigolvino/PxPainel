import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { withUserContext } from "@/lib/db/user-context";
import type { PatientInput, TemplateInput } from "./domain/schemas";
import type { FuConsultation, FuPatient, FuTemplate } from "./types";

export type { FuConsultation, FuPatient, FuTemplate } from "./types";

export type FailureReason =
  | "not_found"
  | "duplicate_name"
  | "patient_archived"
  | "consult_future"
  | "has_consultations"
  | "template_archived"
  | "template_empty"
  | "has_plan"
  | "no_plan"
  | "plan_canceled"
  | "step_locked"
  | "nothing_to_do"
  | "invalid_date"
  | "has_appointment"
  | "appointment_closed"
  | "appointment_future"
  | "invalid_duration"
  | "error";

export type MutationResult = { ok: true; id?: string; count?: number } | { ok: false; reason: FailureReason };

type PgError = { code?: string; message?: string; constraint?: string };

/** Traduz erros do banco em motivos de negócio; registra SÓ o código (nunca dados de pacientes). */
export function toFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "P0001" && e.message === "fu_patient_archived") return { ok: false, reason: "patient_archived" };
  if (e?.code === "P0001" && e.message === "fu_consult_future") return { ok: false, reason: "consult_future" };
  if (e?.code === "P0001" && e.message === "fu_step_locked") return { ok: false, reason: "step_locked" };
  if (e?.code === "P0001" && e.message === "fu_plan_canceled") return { ok: false, reason: "plan_canceled" };
  if (e?.code === "23505" && e.constraint === "fu_templates_user_name_key") return { ok: false, reason: "duplicate_name" };
  if (e?.code === "23505" && e.constraint === "fu_plans_consultation_key") return { ok: false, reason: "has_plan" };
  if (e?.code === "23505" && e.constraint === "fu_appointments_patient_open_key") return { ok: false, reason: "has_appointment" };
  if (e?.code === "P0001" && e.message === "fu_appointment_closed") return { ok: false, reason: "appointment_closed" };
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint === "fu_consultations_patient_fkey") {
    return { ok: false, reason: operation === "patient.delete" ? "has_consultations" : "not_found" };
  }
  if (e?.code === "23503") return { ok: false, reason: "not_found" };
  console.error(`[Meu Painel] followup/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

async function run(operation: string, user: AuthUser, fn: (db: PoolClient) => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await withUserContext(user, fn);
  } catch (error) {
    return toFailure(operation, error);
  }
}

const one = (count: number | null, id?: string): MutationResult => ((count ?? 0) > 0 ? { ok: true, id } : { ok: false, reason: "not_found" });

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------

type PatientRow = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  consultations: number;
  last_consult: string | null;
  pending: number;
  next_id: string | null;
  next_date: string | null;
  next_time: string | null;
  plan_consult: string | null;
  plan_duration: number | null;
  plan_notice: number | null;
};

const PATIENT_SELECT = `
  select p.id, p.name, p.phone, p.notes, p.archived_at is not null as archived,
         to_char(p.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as created_at,
         to_char(p.updated_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as updated_at,
         (select count(*)::int from public.fu_consultations c where c.patient_id = p.id) as consultations,
         (select to_char(max(c.consult_date), 'YYYY-MM-DD') from public.fu_consultations c where c.patient_id = p.id) as last_consult,
         (select count(*)::int from public.fu_steps s join public.fu_plans pl on pl.id = s.plan_id
           where pl.patient_id = p.id and s.status = 'pendente') as pending,
         na.id as next_id, to_char(na.scheduled_date, 'YYYY-MM-DD') as next_date, to_char(na.scheduled_time, 'HH24:MI') as next_time,
         to_char(lp.consult_date, 'YYYY-MM-DD') as plan_consult, lp.duration_days as plan_duration, lp.notice_days as plan_notice
    from public.fu_patients p
    left join public.fu_appointments na on na.patient_id = p.id and na.status = 'agendada'
    left join lateral (
      select c.consult_date, pl.duration_days, pl.notice_days
        from public.fu_plans pl join public.fu_consultations c on c.id = pl.consultation_id
       where pl.patient_id = p.id and pl.status = 'ativo'
       order by c.consult_date desc, pl.created_at desc limit 1
    ) lp on true`;

function mapPatient(r: PatientRow): FuPatient {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    archived: r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    consultationCount: r.consultations,
    lastConsultDate: r.last_consult,
    pendingSteps: r.pending,
    nextAppointment: r.next_id && r.next_date ? { id: r.next_id, date: r.next_date, time: r.next_time } : null,
    latestPlan: r.plan_consult ? { consultDate: r.plan_consult, durationDays: r.plan_duration, noticeDays: r.plan_notice } : null,
  };
}

export async function listPatients(user: AuthUser): Promise<FuPatient[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<PatientRow>(`${PATIENT_SELECT} order by lower(p.name), p.created_at, p.id`);
    return rows.map(mapPatient);
  });
}

export async function getPatient(user: AuthUser, id: string): Promise<{ patient: FuPatient; consultations: FuConsultation[] } | null> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<PatientRow>(`${PATIENT_SELECT} where p.id = $1`, [id]);
    if (!rows[0]) return null;
    const consultations = await db.query<{ id: string; patient_id: string; consult_date: string; notes: string | null; created_at: string; updated_at: string }>(
      `select id, patient_id, to_char(consult_date, 'YYYY-MM-DD') as consult_date, notes,
              to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as created_at,
              to_char(updated_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as updated_at
         from public.fu_consultations where patient_id = $1
        order by fu_consultations.consult_date desc, fu_consultations.created_at desc, id`,
      [id],
    );
    return {
      patient: mapPatient(rows[0]),
      consultations: consultations.rows.map((c) => ({
        id: c.id,
        patientId: c.patient_id,
        consultDate: c.consult_date,
        notes: c.notes,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    };
  });
}

export function createPatient(user: AuthUser, input: PatientInput) {
  return run("patient.create", user, async (db) => {
    const { rows } = await db.query<{ id: string }>("insert into public.fu_patients (user_id, name, phone, notes) values ($1, $2, $3, $4) returning id", [
      user.id,
      input.name,
      input.phone,
      input.notes,
    ]);
    return { ok: true, id: rows[0].id };
  });
}

export function updatePatient(user: AuthUser, id: string, input: PatientInput) {
  return run("patient.update", user, async (db) =>
    one((await db.query("update public.fu_patients set name = $2, phone = $3, notes = $4 where id = $1", [id, input.name, input.phone, input.notes])).rowCount, id),
  );
}

/** Arquivar não cancela acompanhamentos; devolve quantas etapas pendentes continuam abertas. */
export function setPatientArchived(user: AuthUser, id: string, archived: boolean) {
  return run(archived ? "patient.archive" : "patient.restore", user, async (db) => {
    const r = await db.query(
      `update public.fu_patients set archived_at = ${archived ? "now()" : "null"} where id = $1 and (archived_at is null) = $2`,
      [id, archived],
    );
    if (!r.rowCount) return { ok: false, reason: "not_found" };
    const pending = (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.fu_steps s join public.fu_plans pl on pl.id = s.plan_id where pl.patient_id = $1 and s.status = 'pendente'",
        [id],
      )
    ).rows[0].n;
    return { ok: true, id, count: pending };
  });
}

/** Exclusão definitiva só sem consultas (RESTRICT no banco). */
export function deletePatient(user: AuthUser, id: string) {
  return run("patient.delete", user, async (db) => one((await db.query("delete from public.fu_patients where id = $1", [id])).rowCount));
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function updateConsultationNotes(user: AuthUser, id: string, notes: string | null) {
  return run("consultation.notes", user, async (db) => one((await db.query("update public.fu_consultations set notes = $2 where id = $1", [id, notes])).rowCount, id));
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export async function listTemplates(user: AuthUser): Promise<FuTemplate[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; description: string | null; version: number; archived: boolean; plans: number; duration_days: number | null; notice_days: number | null }>(
      `select t.id, t.name, t.description, t.version, t.archived_at is not null as archived, t.duration_days, t.notice_days,
              (select count(*)::int from public.fu_plans pl where pl.template_id = t.id) as plans
         from public.fu_templates t order by lower(t.name), t.id`,
    );
    const steps = await db.query<{ template_id: string; day_offset: number; message: string; position: number }>(
      "select template_id, day_offset, message, position from public.fu_template_steps order by template_id, position, day_offset",
    );
    const byTemplate = new Map<string, FuTemplate["steps"]>();
    for (const s of steps.rows) byTemplate.set(s.template_id, [...(byTemplate.get(s.template_id) ?? []), { dayOffset: s.day_offset, message: s.message, position: s.position }]);
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      version: t.version,
      archived: t.archived,
      durationDays: t.duration_days,
      noticeDays: t.notice_days,
      steps: byTemplate.get(t.id) ?? [],
      planCount: t.plans,
    }));
  });
}

async function insertSteps(db: PoolClient, userId: string, templateId: string, steps: TemplateInput["steps"]) {
  for (const [position, step] of steps.entries()) {
    await db.query("insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, $3, $4, $5)", [
      userId,
      templateId,
      step.dayOffset,
      step.message,
      position,
    ]);
  }
}

export function createTemplate(user: AuthUser, input: TemplateInput) {
  return run("template.create", user, async (db) => {
    const { rows } = await db.query<{ id: string }>("insert into public.fu_templates (user_id, name, description, duration_days, notice_days) values ($1, $2, $3, $4, $5) returning id", [
      user.id,
      input.name,
      input.description,
      input.durationDays,
      input.noticeDays,
    ]);
    await insertSteps(db, user.id, rows[0].id, input.steps);
    return { ok: true, id: rows[0].id };
  });
}

/**
 * Edição: nova versão do modelo (etapas substituídas numa transação, com a linha travada).
 * Planos já gerados guardam a própria cópia e não mudam.
 */
export function updateTemplate(user: AuthUser, id: string, input: TemplateInput) {
  return run("template.update", user, async (db) => {
    const locked = await db.query("select 1 from public.fu_templates where id = $1 for update", [id]);
    if (!locked.rowCount) return { ok: false, reason: "not_found" };
    await db.query("update public.fu_templates set name = $2, description = $3, duration_days = $4, notice_days = $5, version = version + 1 where id = $1", [id, input.name, input.description, input.durationDays, input.noticeDays]);
    await db.query("delete from public.fu_template_steps where template_id = $1", [id]);
    await insertSteps(db, user.id, id, input.steps);
    return { ok: true, id };
  });
}

export function setTemplateArchived(user: AuthUser, id: string, archived: boolean) {
  return run(archived ? "template.archive" : "template.restore", user, async (db) =>
    one((await db.query(`update public.fu_templates set archived_at = ${archived ? "now()" : "null"} where id = $1`, [id])).rowCount, id),
  );
}
