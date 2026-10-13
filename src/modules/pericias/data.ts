import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import { cnpjRateIn } from "@/modules/cnpj/data";
import type { CompanyInput, ExamInput } from "./domain/schemas";
import type { PerCompany, PerEvent, PerExam } from "./types";

export type FailureReason = "not_found" | "duplicate_name" | "company_archived" | "has_links" | "locked" | "received" | "nothing_to_do" | "receipt_future" | "cnpj_not_found" | "error";

export type MutationResult = { ok: true; id?: string; count?: number } | { ok: false; reason: FailureReason; detail?: string };

type PgError = { code?: string; message?: string; constraint?: string };

/** Traduz erros do banco em motivos; registra só o código. */
export function toFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "23505" && e.constraint === "per_companies_user_name_key") return { ok: false, reason: "duplicate_name" };
  if (e?.code === "P0001" && e.message === "per_company_archived") return { ok: false, reason: "company_archived" };
  if (e?.code === "P0001" && e.message === "per_exam_received") return { ok: false, reason: "received" };
  if (e?.code === "P0001" && e.message === "per_exam_locked") return { ok: false, reason: "locked" };
  if (e?.code === "P0001" && e.message === "per_receipt_future") return { ok: false, reason: "receipt_future" };
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint?.endsWith("company_fkey")) {
    return { ok: false, reason: operation === "company.delete" ? "has_links" : "not_found" };
  }
  if (e?.code === "23503" && e.constraint?.endsWith("cnpj_fkey")) return { ok: false, reason: "cnpj_not_found" };
  if (e?.code === "23503") return { ok: false, reason: "not_found" };
  console.error(`[Meu Painel] pericias/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

async function run(operation: string, user: AuthUser, fn: (db: PoolClient) => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await withUserContext(user, fn);
  } catch (error) {
    return toFailure(operation, error);
  }
}

async function logEvent(db: PoolClient, userId: string, e: { examId?: string | null; companyId?: string | null; action: string; details?: object }) {
  await db.query("insert into public.per_events (user_id, exam_id, company_id, action, details) values ($1, $2, $3, $4, $5::jsonb)", [
    userId,
    e.examId ?? null,
    e.companyId ?? null,
    e.action,
    JSON.stringify(e.details ?? {}),
  ]);
}

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

export async function listCompanies(user: AuthUser): Promise<PerCompany[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; amount: string; cnpj_id: string | null; archived: boolean; links: number }>(
      `select c.id, c.name, c.default_amount_cents::text as amount, c.cnpj_id, c.archived_at is not null as archived,
              (select count(*)::int from public.per_exams e where e.company_id = c.id) as links
         from public.per_companies c order by lower(c.name), c.id`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, defaultAmountCents: centsFromDb(r.amount), cnpjId: r.cnpj_id, archived: r.archived, links: r.links }));
  });
}

export function createCompany(user: AuthUser, input: CompanyInput) {
  return run("company.create", user, async (db) => {
    const { rows } = await db.query<{ id: string }>("insert into public.per_companies (user_id, name, default_amount_cents, cnpj_id) values ($1, $2, $3, $4) returning id", [user.id, input.name, input.amount, input.cnpjId]);
    await logEvent(db, user.id, { companyId: rows[0].id, action: "empresa_criada", details: { valor_padrao: input.amount, cnpj: input.cnpjId !== null } });
    return { ok: true, id: rows[0].id };
  });
}

/** O valor padrão e a marcação de CNPJ valem para NOVAS perícias: as existentes guardam a própria cópia e não mudam. */
export function updateCompany(user: AuthUser, id: string, input: CompanyInput) {
  return run("company.update", user, async (db) => {
    const before = await db.query<{ amount: string }>("select default_amount_cents::text as amount from public.per_companies where id = $1 for update", [id]);
    if (!before.rows[0]) return { ok: false, reason: "not_found" };
    await db.query("update public.per_companies set name = $2, default_amount_cents = $3, cnpj_id = $4 where id = $1", [id, input.name, input.amount, input.cnpjId]);
    const previous = centsFromDb(before.rows[0].amount);
    if (previous !== input.amount) await logEvent(db, user.id, { companyId: id, action: "empresa_valor_alterado", details: { de: previous, para: input.amount } });
    return { ok: true, id };
  });
}

export function setCompanyArchived(user: AuthUser, id: string, archived: boolean) {
  return run(archived ? "company.archive" : "company.restore", user, async (db) => {
    const r = await db.query(`update public.per_companies set archived_at = ${archived ? "now()" : "null"} where id = $1 and (archived_at is null) = $2`, [id, archived]);
    if (!r.rowCount) return { ok: false, reason: "not_found" };
    await logEvent(db, user.id, { companyId: id, action: archived ? "empresa_arquivada" : "empresa_restaurada" });
    return { ok: true, id };
  });
}

/** Exclusão definitiva só sem perícias (RESTRICT no banco). */
export function deleteCompany(user: AuthUser, id: string) {
  return run("company.delete", user, async (db) => {
    const r = await db.query("delete from public.per_companies where id = $1", [id]);
    return r.rowCount ? { ok: true } : { ok: false, reason: "not_found" };
  });
}

// ---------------------------------------------------------------------------
// Perícias
// ---------------------------------------------------------------------------

export const EXAM_COLUMNS = `e.id, e.company_id, c.name as company_name, to_char(e.exam_date, 'YYYY-MM-DD') as date, to_char(e.exam_time, 'HH24:MI') as time,
  e.amount_cents::text as amount, e.tax_rate_bp, e.cnpj_id, e.notes, e.status,
  to_char(e.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at,
  to_char(e.canceled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as canceled_at,
  to_char(e.received_on, 'YYYY-MM-DD') as received_on`;
const EXAM_FROM = "public.per_exams e join public.per_companies c on c.id = e.company_id";
const EXAM_ORDER = "e.exam_date, e.exam_time, e.created_at, e.id";

export type ExamRow = {
  id: string;
  company_id: string;
  company_name: string;
  date: string;
  time: string;
  amount: string;
  tax_rate_bp: number;
  cnpj_id: string | null;
  notes: string | null;
  status: PerExam["status"];
  done_at: string | null;
  canceled_at: string | null;
  received_on: string | null;
};

export const mapExam = (r: ExamRow): PerExam => ({
  id: r.id,
  companyId: r.company_id,
  companyName: r.company_name,
  date: r.date,
  time: r.time,
  amountCents: centsFromDb(r.amount),
  cnpjId: r.cnpj_id,
  taxRateBp: r.tax_rate_bp,
  notes: r.notes,
  status: r.status,
  doneAt: r.done_at,
  canceledAt: r.canceled_at,
  receivedOn: r.received_on,
});

/** Perícias do intervalo (inclui canceladas; a tela filtra), em ordem de data e horário. */
export async function listExams(user: AuthUser, from: CivilDate, to: CivilDate): Promise<PerExam[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<ExamRow>(`select ${EXAM_COLUMNS} from ${EXAM_FROM} where e.exam_date between $1::date and $2::date order by ${EXAM_ORDER}`, [from, to]);
    return rows.map(mapExam);
  });
}

/** Agendadas de qualquer mês até `until` (inclui as passadas ainda não confirmadas), em ordem. */
export async function listScheduledUntil(user: AuthUser, until: CivilDate): Promise<PerExam[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<ExamRow>(`select ${EXAM_COLUMNS} from ${EXAM_FROM} where e.status = 'agendada' and e.exam_date <= $1::date order by ${EXAM_ORDER} limit 300`, [until]);
    return rows.map(mapExam);
  });
}

export async function getExamEvents(user: AuthUser, examId: string): Promise<PerEvent[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; exam_id: string | null; action: string; details: Record<string, unknown>; created_at: string }>(
      `select id, exam_id, action, details, to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at
         from public.per_events where exam_id = $1 order by per_events.created_at, id`,
      [examId],
    );
    return rows.map((e) => ({ id: e.id, examId: e.exam_id, action: e.action, details: e.details, createdAt: e.created_at }));
  });
}

/**
 * Nova perícia. O valor e a marcação de CNPJ vêm do formulário (que copia o padrão da empresa e permite
 * ajuste). Por CNPJ, a alíquota é o percentual do CNPJ NO MOMENTO da criação e fica gravada na perícia;
 * sem CNPJ, é zero. Idempotente pelo requestId.
 */
export function createExam(user: AuthUser, input: ExamInput & { requestId: string }) {
  return run("exam.create", user, async (db) => {
    const again = await db.query<{ id: string }>("select id from public.per_exams where request_id = $1", [input.requestId]);
    if (again.rows[0]) return { ok: true, id: again.rows[0].id };
    const rateBp = input.cnpjId ? await cnpjRateIn(db, input.cnpjId) : 0;
    if (rateBp === null) return { ok: false, reason: "cnpj_not_found" };
    const { rows } = await db.query<{ id: string }>(
      `insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, notes, request_id, cnpj_id)
       values ($1, $2, $3::date, $4::time, $5, $6, $7, $8, $9)
       on conflict (user_id, request_id) where request_id is not null do nothing returning id`,
      [user.id, input.companyId, input.date, input.time, input.amount, rateBp, input.notes, input.requestId, input.cnpjId],
    );
    if (!rows[0]) return { ok: true }; // envio simultâneo do mesmo formulário: o outro já gravou
    await logEvent(db, user.id, { examId: rows[0].id, companyId: input.companyId, action: "criada", details: { data: input.date, horario: input.time, valor: input.amount, cnpj: input.cnpjId !== null, aliquota_bp: rateBp } });
    return { ok: true, id: rows[0].id };
  });
}

type LockedExam = { id: string; company_id: string; date: string; time: string; amount: string; cnpj_id: string | null; tax_rate_bp: number; notes: string | null; status: string; received_on: string | null; done_at: string | null };

async function lockExam(db: PoolClient, id: string): Promise<LockedExam | null> {
  const { rows } = await db.query<LockedExam>(
    `select e.id, e.company_id, to_char(e.exam_date, 'YYYY-MM-DD') as date, to_char(e.exam_time, 'HH24:MI') as time, e.amount_cents::text as amount, e.cnpj_id, e.tax_rate_bp, e.notes, e.status,
            to_char(e.received_on, 'YYYY-MM-DD') as received_on, to_char(e.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at
       from public.per_exams e where e.id = $1 for update`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Edição: empresa, data, horário, valor, CNPJ e observação. No mesmo CNPJ a alíquota gravada é
 * preservada; CNPJ marcado ou trocado agora usa o percentual atual dele; sem CNPJ, zero.
 * A marcação de CNPJ pode mudar mesmo com recebimento registrado: o imposto é uma estimativa à parte.
 */
export function updateExam(user: AuthUser, id: string, input: ExamInput) {
  return run("exam.update", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if (e.status === "cancelada") return { ok: false, reason: "locked" };
    const before = { empresa: e.company_id, data: e.date, horario: e.time, valor: centsFromDb(e.amount) };
    const after = { empresa: input.companyId, data: input.date, horario: input.time, valor: input.amount };
    const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => before[k] !== after[k]);
    const notesChanged = (e.notes ?? null) !== input.notes;
    const cnpjChanged = e.cnpj_id !== input.cnpjId;
    if (changed.length === 0 && !notesChanged && !cnpjChanged) return { ok: false, reason: "nothing_to_do" };
    if (e.received_on && changed.includes("valor")) return { ok: false, reason: "received" };
    const rateBp = input.cnpjId ? (cnpjChanged ? await cnpjRateIn(db, input.cnpjId) : e.tax_rate_bp) : 0;
    if (rateBp === null) return { ok: false, reason: "cnpj_not_found" };
    await db.query("update public.per_exams set company_id = $2, exam_date = $3::date, exam_time = $4::time, amount_cents = $5, notes = $6, cnpj_id = $7, tax_rate_bp = $8 where id = $1", [
      id,
      input.companyId,
      input.date,
      input.time,
      input.amount,
      input.notes,
      input.cnpjId,
      rateBp,
    ]);
    await logEvent(db, user.id, {
      examId: id,
      companyId: input.companyId,
      action: "editada",
      details: {
        ...Object.fromEntries(changed.map((k) => [k, { de: before[k], para: after[k] }])),
        ...(cnpjChanged ? { cnpj: { de: e.cnpj_id !== null, para: input.cnpjId !== null }, aliquota_bp: rateBp } : {}),
        ...(notesChanged ? { observacao_alterada: true } : {}),
      },
    });
    return { ok: true, id };
  });
}

/** Marcar/desfazer realização (manual; data passada não realiza sozinha). Não registra recebimento. */
export function setExamDone(user: AuthUser, id: string, done: boolean) {
  return run(done ? "exam.done" : "exam.undone", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if (e.status === "cancelada") return { ok: false, reason: "locked" };
    if ((e.status === "realizada") === done) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.per_exams set status = $2 where id = $1", [id, done ? "realizada" : "agendada"]);
    await logEvent(db, user.id, { examId: id, companyId: e.company_id, action: done ? "realizada" : "realizacao_desfeita", details: done ? { data: e.date } : { realizada_em: e.done_at } });
    return { ok: true, id };
  });
}

/** Cancelar mantém o registro (fora dos totais), acessível por filtro e histórico. */
export function setExamCanceled(user: AuthUser, id: string, canceled: boolean) {
  return run(canceled ? "exam.cancel" : "exam.restore", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if ((e.status === "cancelada") === canceled) return { ok: false, reason: "nothing_to_do" };
    if (canceled && e.received_on) return { ok: false, reason: "received" };
    if (canceled && e.status === "realizada") return { ok: false, reason: "locked", detail: "realizada" };
    await db.query("update public.per_exams set status = $2 where id = $1", [id, canceled ? "cancelada" : "agendada"]);
    await logEvent(db, user.id, { examId: id, companyId: e.company_id, action: canceled ? "cancelada" : "restaurada", details: { data: e.date } });
    return { ok: true, id };
  });
}

/** Exclusão definitiva: só agendada e sem recebimento. */
export function deleteExam(user: AuthUser, id: string) {
  return run("exam.delete", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if (e.status !== "agendada" || e.received_on) return { ok: false, reason: "locked" };
    await logEvent(db, user.id, { examId: id, companyId: e.company_id, action: "excluida", details: { data: e.date, valor: centsFromDb(e.amount) } });
    await db.query("delete from public.per_exams where id = $1", [id]);
    return { ok: true };
  });
}

/** Recebimento: só a data (até hoje). Não marca a perícia como realizada. */
export function receiveExam(user: AuthUser, id: string, receivedOn: CivilDate) {
  return run("exam.receive", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if (e.status === "cancelada") return { ok: false, reason: "locked" };
    if (e.received_on) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.per_exams set received_on = $2::date where id = $1", [id, receivedOn]);
    await logEvent(db, user.id, { examId: id, companyId: e.company_id, action: "recebida", details: { recebido_em: receivedOn } });
    return { ok: true, id };
  });
}

export function undoExamReceipt(user: AuthUser, id: string) {
  return run("exam.unreceive", user, async (db) => {
    const e = await lockExam(db, id);
    if (!e) return { ok: false, reason: "not_found" };
    if (!e.received_on) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.per_exams set received_on = null where id = $1", [id]);
    await logEvent(db, user.id, { examId: id, companyId: e.company_id, action: "recebimento_desfeito", details: { recebido_em: e.received_on } });
    return { ok: true, id };
  });
}
