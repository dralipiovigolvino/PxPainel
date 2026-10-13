import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { AmountKind } from "@/lib/tax";
import { cnpjRateIn } from "@/modules/cnpj/data";
import { overlapping, type Hours } from "./domain/hours";
import type { ShiftInput, TypeInput } from "./domain/schemas";
import type { PlEvent, PlShift, PlType } from "./types";

export type FailureReason =
  | "not_found"
  | "duplicate_name"
  | "type_archived"
  | "has_links"
  | "locked"
  | "received"
  | "needs_confirmation"
  | "nothing_to_do"
  | "receipt_future"
  | "cnpj_not_found"
  | "error";

export type MutationResult = { ok: true; id?: string; count?: number; detail?: string } | { ok: false; reason: FailureReason; count?: number; detail?: string };

type PgError = { code?: string; message?: string; constraint?: string };

/** Traduz erros do banco em motivos; registra só o código. */
export function toFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "23505" && e.constraint === "pl_types_user_name_key") return { ok: false, reason: "duplicate_name" };
  if (e?.code === "P0001" && e.message === "pl_type_archived") return { ok: false, reason: "type_archived" };
  if (e?.code === "P0001" && e.message === "pl_shift_received") return { ok: false, reason: "received" };
  if (e?.code === "P0001" && e.message === "pl_shift_locked") return { ok: false, reason: "locked" };
  if (e?.code === "P0001" && e.message === "pl_receipt_future") return { ok: false, reason: "receipt_future" };
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint?.endsWith("type_fkey")) {
    return { ok: false, reason: operation === "type.delete" ? "has_links" : "not_found" };
  }
  if (e?.code === "23503" && e.constraint?.endsWith("cnpj_fkey")) return { ok: false, reason: "cnpj_not_found" };
  if (e?.code === "23503") return { ok: false, reason: "not_found" };
  console.error(`[Meu Painel] plantoes/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

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

export async function logEvent(db: PoolClient, userId: string, e: { shiftId?: string | null; typeId?: string | null; action: string; details?: object }) {
  await db.query("insert into public.pl_events (user_id, shift_id, type_id, action, details) values ($1, $2, $3, $4, $5::jsonb)", [
    userId,
    e.shiftId ?? null,
    e.typeId ?? null,
    e.action,
    JSON.stringify(e.details ?? {}),
  ]);
}

const hoursOf = (start: string | null, end: string | null, nextDay: boolean | null): Hours => (start && end && nextDay !== null ? { start, end, nextDay } : null);
const hoursParams = (h: Hours) => [h?.start ?? null, h?.end ?? null, h ? h.nextDay : null];
const describeHoursShort = (h: Hours) => (h ? `${h.start}-${h.end}${h.nextDay ? "+1" : ""}` : null);
/** No banco, "recebido por CNPJ" é o valor bruto (com alíquota gravada); sem CNPJ, líquido. */
export const kindOf = (cnpjId: string | null): AmountKind => (cnpjId ? "bruto" : "liquido");

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export async function listTypes(user: AuthUser): Promise<PlType[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{
      id: string;
      name: string;
      location: string | null;
      amount: string;
      cnpj_id: string | null;
      pay_day: number | null;
      pay_month_offset: 0 | 1;
      color: string;
      start: string | null;
      end: string | null;
      next_day: boolean | null;
      notes: string | null;
      archived: boolean;
      links: number;
    }>(
      `select t.id, t.name, t.location, t.default_amount_cents::text as amount, t.cnpj_id, t.pay_day, t.pay_month_offset, t.color,
              to_char(t.default_start, 'HH24:MI') as start, to_char(t.default_end, 'HH24:MI') as "end", t.default_end_next_day as next_day,
              t.default_notes as notes, t.archived_at is not null as archived,
              (select count(*)::int from public.pl_shifts s where s.type_id = t.id)
              + (select count(*)::int from public.pl_series r where r.type_id = t.id) as links
         from public.pl_types t order by lower(t.name), t.id`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location,
      amountCents: centsFromDb(r.amount),
      cnpjId: r.cnpj_id,
      payDay: r.pay_day,
      payMonthOffset: r.pay_month_offset,
      color: r.color,
      hours: hoursOf(r.start, r.end, r.next_day),
      notes: r.notes,
      archived: r.archived,
      links: r.links,
    }));
  });
}

export function createType(user: AuthUser, input: TypeInput) {
  return run("type.create", user, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.pl_types (user_id, name, location, default_amount_cents, color, default_start, default_end, default_end_next_day, default_notes, default_amount_kind, pay_day, pay_month_offset, cnpj_id)
       values ($1, $2, $3, $4, $5, $6::time, $7::time, $8, $9, $10, $11, $12, $13) returning id`,
      [user.id, input.name, input.location, input.amount, input.color, ...hoursParams(input.hours), input.notes, kindOf(input.cnpjId), input.payDay, input.payMonthOffset, input.cnpjId],
    );
    return { ok: true, id: rows[0].id };
  });
}

/**
 * Editar o padrão não altera ocorrências já criadas (cada uma guarda a própria cópia), inclusive a
 * marcação de CNPJ e a regra de pagamento. `count` = 1 quando a regra de pagamento mudou (a tela
 * oferece aplicar aos plantões futuros, com prévia); `detail` = "cnpj" quando a marcação de CNPJ mudou.
 */
export function updateType(user: AuthUser, id: string, input: TypeInput) {
  return run("type.update", user, async (db) => {
    const before = await db.query<{ pay_day: number | null; pay_month_offset: 0 | 1; cnpj_id: string | null }>("select pay_day, pay_month_offset, cnpj_id from public.pl_types where id = $1 for update", [id]);
    if (!before.rows[0]) return { ok: false, reason: "not_found" };
    await db.query(
      `update public.pl_types set name = $2, location = $3, default_amount_cents = $4, color = $5,
              default_start = $6::time, default_end = $7::time, default_end_next_day = $8, default_notes = $9,
              default_amount_kind = $10, pay_day = $11, pay_month_offset = $12, cnpj_id = $13
        where id = $1`,
      [id, input.name, input.location, input.amount, input.color, ...hoursParams(input.hours), input.notes, kindOf(input.cnpjId), input.payDay, input.payMonthOffset, input.cnpjId],
    );
    const ruleChanged = before.rows[0].pay_day !== input.payDay || before.rows[0].pay_month_offset !== input.payMonthOffset;
    if (ruleChanged) await logEvent(db, user.id, { typeId: id, action: "regra_pagamento_alterada", details: { de: before.rows[0].pay_day, para: input.payDay } });
    return { ok: true, id, count: ruleChanged ? 1 : 0, detail: before.rows[0].cnpj_id !== input.cnpjId ? "cnpj" : undefined };
  });
}

export function deleteType(user: AuthUser, id: string) {
  return run("type.delete", user, async (db) => {
    const r = await db.query("delete from public.pl_types where id = $1", [id]);
    return r.rowCount ? { ok: true } : { ok: false, reason: "not_found" };
  });
}

// ---------------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------------

export const SHIFT_COLUMNS = `s.id, s.type_id, to_char(s.shift_date, 'YYYY-MM-DD') as date, to_char(s.start_time, 'HH24:MI') as start,
  to_char(s.end_time, 'HH24:MI') as "end", s.end_next_day as next_day, s.amount_cents::text as amount, s.notes, s.status,
  to_char(s.canceled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as canceled_at,
  s.series_id, to_char(s.original_date, 'YYYY-MM-DD') as original_date, s.is_override, s.moved_at is not null as moved,
  to_char(s.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at, to_char(s.received_on, 'YYYY-MM-DD') as received_on,
  s.received_cents::text as received_cents, s.amount_kind, s.tax_rate_bp, s.cnpj_id, s.pay_day, s.pay_month_offset,
  to_char(s.expected_pay_date, 'YYYY-MM-DD') as expected_pay_date, s.expected_pay_manual`;

export type ShiftRow = {
  id: string;
  type_id: string;
  date: string;
  start: string | null;
  end: string | null;
  next_day: boolean | null;
  amount: string;
  notes: string | null;
  status: PlShift["status"];
  canceled_at: string | null;
  series_id: string | null;
  original_date: string | null;
  is_override: boolean;
  moved: boolean;
  done_at: string | null;
  received_on: string | null;
  received_cents: string | null;
  amount_kind: AmountKind | null;
  tax_rate_bp: number | null;
  cnpj_id: string | null;
  pay_day: number | null;
  pay_month_offset: 0 | 1;
  expected_pay_date: string | null;
  expected_pay_manual: boolean;
};

export const mapShift = (r: ShiftRow): PlShift => ({
  id: r.id,
  typeId: r.type_id,
  date: r.date,
  hours: hoursOf(r.start, r.end, r.next_day),
  amountCents: centsFromDb(r.amount),
  cnpjId: r.cnpj_id,
  amountKind: r.amount_kind,
  taxRateBp: r.tax_rate_bp,
  payDay: r.pay_day,
  payMonthOffset: r.pay_month_offset,
  expectedPayDate: r.expected_pay_date,
  expectedPayManual: r.expected_pay_manual,
  notes: r.notes,
  status: r.status,
  canceledAt: r.canceled_at,
  seriesId: r.series_id,
  originalDate: r.original_date,
  isOverride: r.is_override,
  moved: r.moved,
  doneAt: r.done_at,
  receivedOn: r.received_on,
  receivedCents: r.received_cents === null ? null : centsFromDb(r.received_cents),
});

/** Ocorrências que COMEÇAM no intervalo (inclui canceladas; a tela filtra). */
export async function listShifts(user: AuthUser, from: CivilDate, to: CivilDate): Promise<PlShift[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<ShiftRow>(`select ${SHIFT_COLUMNS} from public.pl_shifts s where s.shift_date between $1::date and $2::date order by s.shift_date, s.start_time nulls last, s.created_at, s.id`, [from, to]);
    return rows.map(mapShift);
  });
}

export async function getShiftEvents(user: AuthUser, shiftId: string): Promise<PlEvent[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; shift_id: string | null; action: string; details: Record<string, unknown>; created_at: string }>(
      `select id, shift_id, action, details, to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at
         from public.pl_events where shift_id = $1 order by pl_events.created_at, id`,
      [shiftId],
    );
    return rows.map((e) => ({ id: e.id, shiftId: e.shift_id, action: e.action, details: e.details, createdAt: e.created_at }));
  });
}

/** Plantões que se sobrepõem a um horário (dias vizinhos incluídos, canceladas fora). */
export async function findOverlaps(db: PoolClient, date: CivilDate, hours: Hours, ignoreId: string | null): Promise<Array<{ id: string; typeName: string; hours: Hours; date: CivilDate }>> {
  if (!hours) return [];
  const { rows } = await db.query<{ id: string; date: string; start: string | null; end: string | null; next_day: boolean | null; type_name: string }>(
    `select s.id, to_char(s.shift_date, 'YYYY-MM-DD') as date, to_char(s.start_time, 'HH24:MI') as start, to_char(s.end_time, 'HH24:MI') as "end",
            s.end_next_day as next_day, t.name as type_name
       from public.pl_shifts s join public.pl_types t on t.id = s.type_id
      where s.shift_date between $1::date and $2::date and s.status <> 'cancelado' and ($3::uuid is null or s.id <> $3::uuid)`,
    [addDays(date, -1), addDays(date, 1), ignoreId],
  );
  const others = rows.map((r) => ({ id: r.id, date: r.date, hours: hoursOf(r.start, r.end, r.next_day), typeName: r.type_name }));
  const hit = new Set(overlapping({ id: ignoreId ?? "novo", date, hours }, others).map((o) => o.id));
  return others.filter((o) => hit.has(o.id));
}

/**
 * Novo plantão avulso (valor, horários e observação vindos do formulário, que copia o padrão do tipo).
 * Idempotente pelo requestId. Sobreposição de horários exige confirmação, não bloqueia.
 */
export function createShift(user: AuthUser, typeId: string, input: ShiftInput & { requestId: string; confirmOverlap: boolean }) {
  return run("shift.create", user, async (db) => {
    const again = await db.query<{ id: string }>("select id from public.pl_shifts where request_id = $1", [input.requestId]);
    if (again.rows[0]) return { ok: true, id: again.rows[0].id };
    if (!input.confirmOverlap) {
      const overlaps = await findOverlaps(db, input.date, input.hours, null);
      if (overlaps.length > 0) return { ok: false, reason: "needs_confirmation", count: overlaps.length, detail: overlaps.map((o) => o.typeName).join(", ") };
    }
    const type = await db.query<{ pay_day: number | null; pay_month_offset: 0 | 1 }>("select pay_day, pay_month_offset from public.pl_types where id = $1", [typeId]);
    if (!type.rows[0]) return { ok: false, reason: "not_found" };
    const payDay = input.payDay ?? type.rows[0].pay_day;
    const payMonthOffset = input.payDay === null ? type.rows[0].pay_month_offset : input.payMonthOffset;
    const rateBp = input.cnpjId ? await cnpjRateIn(db, input.cnpjId) : null;
    if (input.cnpjId && rateBp === null) return { ok: false, reason: "cnpj_not_found" };
    const { rows } = await db.query<{ id: string }>(
      `insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, notes, request_id,
                                     amount_kind, tax_rate_bp, pay_day, pay_month_offset, expected_pay_date, expected_pay_manual, cnpj_id)
       values ($1, $2, $3::date, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12, $13, $14::date, $15, $16)
       on conflict (user_id, request_id) where request_id is not null do nothing returning id`,
      [user.id, typeId, input.date, ...hoursParams(input.hours), input.amount, input.notes, input.requestId, kindOf(input.cnpjId), rateBp, payDay, payMonthOffset, input.expectedPayDate, input.expectedPayDate !== null, input.cnpjId],
    );
    if (!rows[0]) return { ok: true }; // envio simultâneo do mesmo formulário: o outro já gravou
    await logEvent(db, user.id, {
      shiftId: rows[0].id,
      typeId,
      action: "criado",
      details: { data: input.date, valor: input.amount, horario: describeHoursShort(input.hours), cnpj: input.cnpjId !== null, aliquota_bp: rateBp, previsao_manual: input.expectedPayDate },
    });
    return { ok: true, id: rows[0].id };
  });
}

type LockedShift = {
  id: string;
  type_id: string;
  date: string;
  start: string | null;
  end: string | null;
  next_day: boolean | null;
  amount: string;
  notes: string | null;
  status: string;
  received_on: string | null;
  done_at: string | null;
  amount_kind: AmountKind | null;
  tax_rate_bp: number | null;
  cnpj_id: string | null;
  expected_pay_date: string | null;
  expected_pay_manual: boolean;
  pay_day: number | null;
  pay_month_offset: 0 | 1;
};

export async function lockShift(db: PoolClient, id: string): Promise<LockedShift | null> {
  const { rows } = await db.query<LockedShift>(
    `select s.id, s.type_id, to_char(s.shift_date, 'YYYY-MM-DD') as date, to_char(s.start_time, 'HH24:MI') as start, to_char(s.end_time, 'HH24:MI') as "end",
            s.end_next_day as next_day, s.amount_cents::text as amount, s.notes, s.status, to_char(s.received_on, 'YYYY-MM-DD') as received_on,
            to_char(s.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as done_at,
            s.amount_kind, s.tax_rate_bp, s.cnpj_id, s.pay_day, s.pay_month_offset, to_char(s.expected_pay_date, 'YYYY-MM-DD') as expected_pay_date, s.expected_pay_manual
       from public.pl_shifts s where s.id = $1 for update`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Edição individual (valor, CNPJ, horários, observação). A data muda por "Mover" (Etapa 11).
 * Registra antes/depois de valor e horário; observação só como "alterada".
 * A marcação de CNPJ pode mudar mesmo com recebimento registrado: o imposto é uma estimativa à parte.
 */
export function updateShift(user: AuthUser, id: string, input: Omit<ShiftInput, "date" | "payDay" | "payMonthOffset"> & { payDay?: number | null; payMonthOffset?: 0 | 1; confirmOverlap: boolean }) {
  return run("shift.update", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if (s.status === "cancelado") return { ok: false, reason: "locked" };
    const before = hoursOf(s.start, s.end, s.next_day);
    const manualBefore = s.expected_pay_manual ? s.expected_pay_date : null;
    const payDay = input.payDay == null ? s.pay_day : input.payDay;
    const payMonthOffset = input.payDay == null ? s.pay_month_offset : (input.payMonthOffset ?? s.pay_month_offset);
    const changed = {
      valor: centsFromDb(s.amount) !== input.amount,
      horario: describeHoursShort(before) !== describeHoursShort(input.hours),
      observacao: (s.notes ?? null) !== input.notes,
      cnpj: s.cnpj_id !== input.cnpjId,
      previsao: manualBefore !== input.expectedPayDate,
      regraPagamento: s.pay_day !== payDay || s.pay_month_offset !== payMonthOffset,
    };
    if (!Object.values(changed).some(Boolean)) return { ok: false, reason: "nothing_to_do" };
    if (s.received_on && changed.valor) return { ok: false, reason: "received" };
    // Mesmo CNPJ: a alíquota gravada é preservada. CNPJ marcado ou trocado agora: o percentual atual dele.
    const rateBp = input.cnpjId ? (input.cnpjId === s.cnpj_id && s.tax_rate_bp !== null ? s.tax_rate_bp : await cnpjRateIn(db, input.cnpjId)) : null;
    if (input.cnpjId && rateBp === null) return { ok: false, reason: "cnpj_not_found" };
    // Sem CNPJ: registro antigo sem classificação continua como está; os demais ficam "líquido".
    const kind = input.cnpjId ? "bruto" : s.amount_kind === null ? null : "liquido";
    if (changed.horario && !input.confirmOverlap) {
      const overlaps = await findOverlaps(db, s.date, input.hours, id);
      if (overlaps.length > 0) return { ok: false, reason: "needs_confirmation", count: overlaps.length, detail: overlaps.map((o) => o.typeName).join(", ") };
    }
    await db.query(
      `update public.pl_shifts set start_time = $2::time, end_time = $3::time, end_next_day = $4, amount_cents = $5, notes = $6,
              amount_kind = $7, tax_rate_bp = $8, pay_day = $9, pay_month_offset = $10, expected_pay_manual = $11, expected_pay_date = $12::date, cnpj_id = $13, is_override = (series_id is not null)
        where id = $1`,
      [id, ...hoursParams(input.hours), input.amount, input.notes, kind, rateBp, payDay, payMonthOffset, input.expectedPayDate !== null, input.expectedPayDate, input.cnpjId],
    );
    await logEvent(db, user.id, {
      shiftId: id,
      typeId: s.type_id,
      action: "editado",
      details: {
        ...(changed.valor ? { valor: { de: centsFromDb(s.amount), para: input.amount } } : {}),
        ...(changed.horario ? { horario: { de: describeHoursShort(before), para: describeHoursShort(input.hours) } } : {}),
        ...(changed.observacao ? { observacao_alterada: true } : {}),
        ...(changed.cnpj ? { cnpj: { de: s.cnpj_id !== null, para: input.cnpjId !== null }, aliquota_bp: rateBp } : {}),
        ...(changed.previsao ? { previsao: { de: manualBefore, para: input.expectedPayDate } } : {}),
      },
    });
    return { ok: true, id };
  });
}

/** Cancelar mantém a ocorrência (fora do calendário padrão e dos totais), acessível por filtro e histórico. */
export function setShiftCanceled(user: AuthUser, id: string, canceled: boolean) {
  return run(canceled ? "shift.cancel" : "shift.restore", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if ((s.status === "cancelado") === canceled) return { ok: false, reason: "nothing_to_do" };
    if (canceled && s.received_on) return { ok: false, reason: "received" };
    if (canceled && s.status === "realizado") return { ok: false, reason: "locked", detail: "realizado" };
    await db.query("update public.pl_shifts set status = $2 where id = $1", [id, canceled ? "cancelado" : "agendado"]);
    await logEvent(db, user.id, { shiftId: id, typeId: s.type_id, action: canceled ? "cancelado" : "restaurado", details: { data: s.date } });
    return { ok: true, id };
  });
}

/** Exclusão definitiva: só agendado (realizados/recebidos usam cancelamento e correções). */
export function deleteShift(user: AuthUser, id: string) {
  return run("shift.delete", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if (s.status !== "agendado" || s.received_on) return { ok: false, reason: "locked" };
    await logEvent(db, user.id, { shiftId: id, typeId: s.type_id, action: "excluido", details: { data: s.date, valor: centsFromDb(s.amount) } });
    // Ocorrência de série: exceção persistente para não ser recriada pela geração.
    await db.query(
      `insert into public.pl_series_exceptions (series_id, user_id, original_date)
       select series_id, user_id, original_date from public.pl_shifts where id = $1 and series_id is not null
       on conflict do nothing`,
      [id],
    );
    await db.query("delete from public.pl_shifts where id = $1", [id]);
    return { ok: true };
  });
}


// ---------------------------------------------------------------------------
// Realização e recebimento (Etapa 12)
// ---------------------------------------------------------------------------

/** Marcar/desfazer realização (manual; data passada não realiza sozinha). */
export function setShiftDone(user: AuthUser, id: string, done: boolean) {
  return run(done ? "shift.done" : "shift.undone", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if (s.status === "cancelado") return { ok: false, reason: "locked" };
    if ((s.status === "realizado") === done) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.pl_shifts set status = $2 where id = $1", [id, done ? "realizado" : "agendado"]);
    await logEvent(db, user.id, { shiftId: id, typeId: s.type_id, action: done ? "realizado" : "realizacao_desfeita", details: done ? { data: s.date } : { realizado_em: s.done_at } });
    return { ok: true, id };
  });
}

/** Recebimento integral (valor = valor da ocorrência, definido pelo banco); data até hoje. Pode ser antecipado. */
export function receiveShift(user: AuthUser, id: string, receivedOn: CivilDate) {
  return run("shift.receive", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if (s.status === "cancelado") return { ok: false, reason: "locked" };
    if (s.received_on) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.pl_shifts set received_on = $2::date where id = $1", [id, receivedOn]);
    await logEvent(db, user.id, { shiftId: id, typeId: s.type_id, action: "recebido", details: { recebido_em: receivedOn, valor: centsFromDb(s.amount) } });
    return { ok: true, id };
  });
}

/** Desfazer recebimento: limpa a data atual; o registro anterior fica no histórico. */
export function undoReceipt(user: AuthUser, id: string) {
  return run("shift.unreceive", user, async (db) => {
    const s = await lockShift(db, id);
    if (!s) return { ok: false, reason: "not_found" };
    if (!s.received_on) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.pl_shifts set received_on = null where id = $1", [id]);
    await logEvent(db, user.id, { shiftId: id, typeId: s.type_id, action: "recebimento_desfeito", details: { recebido_em: s.received_on, valor: centsFromDb(s.amount) } });
    return { ok: true, id };
  });
}

/** Recebido no mês (pela DATA DO RECEBIMENTO), independentemente do mês trabalhado. */
export async function receivedInPeriod(user: AuthUser, from: CivilDate, to: CivilDate, typeId: string | null): Promise<{ cents: bigint; count: number }> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ total: string; n: number }>(
      `select coalesce(sum(received_cents), 0)::text as total, count(*)::int as n from public.pl_shifts
        where received_on between $1::date and $2::date and status <> 'cancelado' and ($3::uuid is null or type_id = $3::uuid)`,
      [from, to, typeId],
    );
    return { cents: BigInt(rows[0].total), count: rows[0].n };
  });
}

/** Agendados com data passada ("a confirmar"), de qualquer mês, fora da grade. */
export async function listToConfirm(user: AuthUser, today: CivilDate): Promise<PlShift[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<ShiftRow>(
      `select ${SHIFT_COLUMNS} from public.pl_shifts s where s.status = 'agendado' and s.shift_date < $1::date order by s.shift_date, s.id limit 200`,
      [today],
    );
    return rows.map(mapShift);
  });
}
