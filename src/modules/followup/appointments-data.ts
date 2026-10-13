import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import type { MutationResult } from "./data";
import { checkDuration } from "./domain/deadline";
import { logEvent, run } from "./plans-data";
import type { FuAppointment, FuPlanDeadline } from "./types";

// ---------------------------------------------------------------------------
// Prazo do acompanhamento
// ---------------------------------------------------------------------------

/**
 * Define (ou altera) a duração e o aviso de UM acompanhamento ativo — ação explícita, registrada no
 * histórico. Não mexe em etapas: a duração precisa cobrir a última etapa viva do plano.
 */
export function setPlanDeadline(user: AuthUser, planId: string, durationDays: number, noticeDays: number): Promise<MutationResult> {
  return run("plan.deadline", user, async (db) => {
    const { rows } = await db.query<{ status: string; patient_id: string; consultation_id: string; duration_days: number | null; notice_days: number | null }>(
      "select status, patient_id, consultation_id, duration_days, notice_days from public.fu_plans where id = $1 for update",
      [planId],
    );
    const plan = rows[0];
    if (!plan) return { ok: false, reason: "not_found" };
    if (plan.status !== "ativo") return { ok: false, reason: "plan_canceled" };
    if (plan.duration_days === durationDays && plan.notice_days === noticeDays) return { ok: false, reason: "nothing_to_do" };
    const offsets = await db.query<{ day_offset: number }>("select day_offset from public.fu_steps where plan_id = $1 and status <> 'cancelado'", [planId]);
    if (!checkDuration(durationDays, noticeDays, offsets.rows.map((r) => r.day_offset)).ok) return { ok: false, reason: "invalid_duration" };
    await db.query("update public.fu_plans set duration_days = $2, notice_days = $3 where id = $1", [planId, durationDays, noticeDays]);
    await logEvent(db, user.id, {
      patientId: plan.patient_id,
      consultationId: plan.consultation_id,
      planId,
      action: "prazo_definido",
      details: { de: { duracao_dias: plan.duration_days, aviso_dias: plan.notice_days }, para: { duracao_dias: durationDays, aviso_dias: noticeDays } },
    });
    return { ok: true, id: planId };
  });
}

/** Acompanhamentos ATIVOS com duração definida (para os avisos de término). Só nome, datas e prazos. */
export async function listPlanDeadlines(user: AuthUser): Promise<FuPlanDeadline[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{
      plan_id: string;
      patient_id: string;
      patient_name: string;
      patient_archived: boolean;
      consultation_id: string;
      consult_date: string;
      duration_days: number;
      notice_days: number;
      next_date: string | null;
      next_time: string | null;
    }>(
      `select pl.id as plan_id, pl.patient_id, pt.name as patient_name, pt.archived_at is not null as patient_archived, pl.consultation_id,
              to_char(c.consult_date, 'YYYY-MM-DD') as consult_date, pl.duration_days, pl.notice_days,
              to_char(a.scheduled_date, 'YYYY-MM-DD') as next_date, to_char(a.scheduled_time, 'HH24:MI') as next_time
         from public.fu_plans pl
         join public.fu_consultations c on c.id = pl.consultation_id
         join public.fu_patients pt on pt.id = pl.patient_id
         left join public.fu_appointments a on a.patient_id = pl.patient_id and a.status = 'agendada'
        where pl.status = 'ativo' and pl.duration_days is not null
        order by c.consult_date + pl.duration_days, pl.id`,
    );
    return rows.map((r) => ({
      planId: r.plan_id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      patientArchived: r.patient_archived,
      consultationId: r.consultation_id,
      consultDate: r.consult_date,
      durationDays: r.duration_days,
      noticeDays: r.notice_days,
      nextAppointment: r.next_date ? { date: r.next_date, time: r.next_time } : null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Próxima consulta agendada
// ---------------------------------------------------------------------------

const APPOINTMENT_COLUMNS = `a.id, a.patient_id, a.plan_id, to_char(a.scheduled_date, 'YYYY-MM-DD') as date, to_char(a.scheduled_time, 'HH24:MI') as time, a.status, a.consultation_id,
  to_char(a.canceled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as canceled_at,
  to_char(a.confirmed_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as confirmed_at`;

type AppointmentRow = {
  id: string;
  patient_id: string;
  plan_id: string | null;
  date: string;
  time: string | null;
  status: FuAppointment["status"];
  consultation_id: string | null;
  canceled_at: string | null;
  confirmed_at: string | null;
};

const mapAppointment = (r: AppointmentRow): FuAppointment => ({
  id: r.id,
  patientId: r.patient_id,
  planId: r.plan_id,
  date: r.date,
  time: r.time,
  status: r.status,
  consultationId: r.consultation_id,
  canceledAt: r.canceled_at,
  confirmedAt: r.confirmed_at,
});

/** Agendamentos do paciente (o em aberto primeiro; depois os mais recentes). */
export async function listPatientAppointments(user: AuthUser, patientId: string): Promise<FuAppointment[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<AppointmentRow>(
      `select ${APPOINTMENT_COLUMNS} from public.fu_appointments a where a.patient_id = $1 order by (a.status = 'agendada') desc, a.scheduled_date desc, a.created_at desc, a.id limit 50`,
      [patientId],
    );
    return rows.map(mapAppointment);
  });
}

/** Agendamentos em aberto com data já passada, de todos os pacientes: é preciso confirmar o atendimento. */
export async function listAppointmentsToConfirm(user: AuthUser, today: CivilDate): Promise<Array<FuAppointment & { patientName: string }>> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<AppointmentRow & { patient_name: string }>(
      `select ${APPOINTMENT_COLUMNS}, pt.name as patient_name from public.fu_appointments a join public.fu_patients pt on pt.id = a.patient_id
        where a.status = 'agendada' and a.scheduled_date < $1::date order by a.scheduled_date, a.id limit 200`,
      [today],
    );
    return rows.map((r) => ({ ...mapAppointment(r), patientName: r.patient_name }));
  });
}

async function lockAppointment(db: PoolClient, id: string): Promise<AppointmentRow | null> {
  const { rows } = await db.query<AppointmentRow>(`select ${APPOINTMENT_COLUMNS} from public.fu_appointments a where a.id = $1 for update`, [id]);
  return rows[0] ?? null;
}

/**
 * Agenda a próxima consulta do paciente (uma em aberto por paciente). Guarda o acompanhamento ativo
 * mais recente como origem. NÃO cria consulta nem acompanhamento. Idempotente pelo requestId.
 */
export function scheduleAppointment(user: AuthUser, patientId: string, input: { date: CivilDate; time: string | null; requestId: string }): Promise<MutationResult> {
  return run("appointment.create", user, async (db) => {
    const again = await db.query<{ id: string }>("select id from public.fu_appointments where request_id = $1", [input.requestId]);
    if (again.rows[0]) return { ok: true, id: again.rows[0].id };
    const patient = await db.query("select 1 from public.fu_patients where id = $1", [patientId]);
    if (!patient.rowCount) return { ok: false, reason: "not_found" };
    const origin = await db.query<{ id: string; consultation_id: string }>(
      `select pl.id, pl.consultation_id from public.fu_plans pl join public.fu_consultations c on c.id = pl.consultation_id
        where pl.patient_id = $1 and pl.status = 'ativo' order by c.consult_date desc, pl.created_at desc limit 1`,
      [patientId],
    );
    const { rows } = await db.query<{ id: string }>(
      "insert into public.fu_appointments (user_id, patient_id, plan_id, scheduled_date, scheduled_time, request_id) values ($1, $2, $3, $4::date, $5::time, $6) returning id",
      [user.id, patientId, origin.rows[0]?.id ?? null, input.date, input.time, input.requestId],
    );
    await logEvent(db, user.id, {
      patientId,
      consultationId: origin.rows[0]?.consultation_id ?? null,
      planId: origin.rows[0]?.id ?? null,
      action: "proxima_consulta_agendada",
      details: { data: input.date, horario: input.time },
    });
    return { ok: true, id: rows[0].id };
  });
}

export function rescheduleAppointment(user: AuthUser, id: string, input: { date: CivilDate; time: string | null }): Promise<MutationResult> {
  return run("appointment.reschedule", user, async (db) => {
    const a = await lockAppointment(db, id);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status !== "agendada") return { ok: false, reason: "appointment_closed" };
    if (a.date === input.date && a.time === input.time) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.fu_appointments set scheduled_date = $2::date, scheduled_time = $3::time where id = $1", [id, input.date, input.time]);
    await logEvent(db, user.id, { patientId: a.patient_id, planId: a.plan_id, action: "proxima_consulta_reagendada", details: { de: { data: a.date, horario: a.time }, para: { data: input.date, horario: input.time } } });
    return { ok: true, id };
  });
}

/** Cancela o agendamento (o registro continua no histórico). Não altera o acompanhamento. */
export function cancelAppointment(user: AuthUser, id: string): Promise<MutationResult> {
  return run("appointment.cancel", user, async (db) => {
    const a = await lockAppointment(db, id);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status !== "agendada") return { ok: false, reason: "appointment_closed" };
    await db.query("update public.fu_appointments set status = 'cancelada' where id = $1", [id]);
    await logEvent(db, user.id, { patientId: a.patient_id, planId: a.plan_id, action: "proxima_consulta_cancelada", details: { data: a.date, horario: a.time } });
    return { ok: true, id };
  });
}

/**
 * Confirma que o atendimento agendado ACONTECEU: registra a consulta na data agendada (sem
 * acompanhamento — aplicar um modelo continua sendo uma decisão explícita) e encerra o agendamento.
 * Só para datas até hoje.
 */
export function confirmAppointment(user: AuthUser, id: string, today: CivilDate): Promise<MutationResult> {
  return run("appointment.confirm", user, async (db) => {
    const a = await lockAppointment(db, id);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status !== "agendada") return { ok: false, reason: "appointment_closed" };
    if (a.date > today) return { ok: false, reason: "appointment_future" };
    const consultation = await db.query<{ id: string }>("insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, $3::date) returning id", [user.id, a.patient_id, a.date]);
    await db.query("update public.fu_appointments set status = 'realizada', consultation_id = $2 where id = $1", [id, consultation.rows[0].id]);
    await logEvent(db, user.id, { patientId: a.patient_id, consultationId: consultation.rows[0].id, planId: a.plan_id, action: "proxima_consulta_confirmada", details: { data: a.date, horario: a.time } });
    return { ok: true, id: consultation.rows[0].id };
  });
}
