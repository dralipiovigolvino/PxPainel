import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, daysBetween, todayInSaoPaulo, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { AmountKind } from "@/lib/tax";
import { cnpjRateIn } from "@/modules/cnpj/data";
import { generationWindow } from "@/modules/financas/domain/recurrence";
import { Abort, kindOf, lockShift, logEvent, run, type MutationResult } from "./data";
import type { Hours } from "./domain/hours";
import { maskOf, occurrencesBetween, shiftWeekdays, weekdaysOf, type WeeklyRule } from "./domain/recurrence";

/**
 * Ocorrência "substituível" numa edição/encerramento da série: agendada, não alterada individualmente,
 * não movida e não recebida. Realizadas, recebidas, movidas e alteradas são preservadas.
 */
const REPLACEABLE = `(s.status = 'agendado' and not s.is_override and s.moved_at is null and s.received_on is null)`;

export type PlSeries = {
  id: string;
  typeId: string;
  weekdays: number[];
  intervalWeeks: number;
  startDate: CivilDate;
  endDate: CivilDate | null;
  amountCents: number;
  /** CNPJ (null = sem CNPJ), alíquota e regra de pagamento copiados para as ocorrências geradas. */
  cnpjId: string | null;
  taxRateBp: number | null;
  payDay: number | null;
  payMonthOffset: 0 | 1;
  hours: Hours;
  notes: string | null;
  generatedUntil: CivilDate | null;
  suspended: boolean;
  nextDate: CivilDate | null;
  upcoming: number;
};

export type SeriesInput = {
  typeId: string;
  weekdays: number[];
  intervalWeeks: number;
  startDate: CivilDate;
  endDate: CivilDate | null;
  amount: number;
  /** "Recebo por CNPJ": o CNPJ dos plantões da recorrência; null = sem CNPJ. */
  cnpjId: string | null;
  /** Internos (divisão/movimentação preservam os da série anterior). Ausentes: percentual atual do CNPJ e regra do tipo. */
  taxRateBp?: number | null;
  payDay?: number | null;
  payMonthOffset?: 0 | 1;
  hours: Hours;
  notes: string | null;
};

type SeriesRow = {
  id: string;
  type_id: string;
  weekday_mask: number;
  interval_weeks: number;
  start_date: string;
  end_date: string | null;
  amount: string;
  amount_kind: AmountKind | null;
  tax_rate_bp: number | null;
  cnpj_id: string | null;
  pay_day: number | null;
  pay_month_offset: 0 | 1;
  start: string | null;
  end: string | null;
  next_day: boolean | null;
  notes: string | null;
  generated_until: string | null;
  suspended: boolean;
};

const SERIES_COLUMNS = `s.id, s.type_id, s.weekday_mask, s.interval_weeks, to_char(s.start_date, 'YYYY-MM-DD') as start_date,
  to_char(s.end_date, 'YYYY-MM-DD') as end_date, s.amount_cents::text as amount, to_char(s.start_time, 'HH24:MI') as start,
  to_char(s.end_time, 'HH24:MI') as "end", s.end_next_day as next_day, s.notes, to_char(s.generated_until, 'YYYY-MM-DD') as generated_until,
  s.suspended_at is not null as suspended, s.amount_kind, s.tax_rate_bp, s.cnpj_id, s.pay_day, s.pay_month_offset`;

const ruleOf = (s: SeriesRow): WeeklyRule => ({ startDate: s.start_date, intervalWeeks: s.interval_weeks, weekdays: weekdaysOf(s.weekday_mask), endDate: s.end_date });

/** Horizonte padrão e limite de segurança (mesma regra pura das recorrências de Finanças). */
export const plGenerationWindow = (needed: CivilDate, today = todayInSaoPaulo()) => generationWindow(needed, today);

/**
 * Materializa as ocorrências até `target` (deve rodar dentro da transação da operação).
 * Idempotente (UNIQUE série + data original, ON CONFLICT DO NOTHING), serializada (FOR UPDATE nas séries),
 * respeita exceções, séries suspensas e tipos arquivados.
 */
export async function generateForUser(db: PoolClient, userId: string, target: CivilDate): Promise<number> {
  const { rows } = await db.query<SeriesRow>(
    `select ${SERIES_COLUMNS}
       from public.pl_series s
       join public.pl_types t on t.id = s.type_id and t.user_id = s.user_id
      where s.suspended_at is null and t.archived_at is null
        and (s.generated_until is null or s.generated_until < $1::date)
        and (s.end_date is null or s.generated_until is null or s.generated_until < s.end_date)
      order by s.id
      for update of s`,
    [target],
  );
  let created = 0;
  for (const s of rows) {
    const from = s.generated_until ? addDays(s.generated_until, 1) : s.start_date;
    const dates = occurrencesBetween(ruleOf(s), from, target);
    if (dates.length > 0) {
      const inserted = await db.query(
        // CNPJ, alíquota e regra de pagamento vêm da série; a data prevista é calculada pelo banco.
        `insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, notes, series_id, original_date,
                                       amount_kind, tax_rate_bp, pay_day, pay_month_offset, cnpj_id)
         select $1, $2, d, $3::time, $4::time, $5, $6::bigint, $7, $8, d, $10, $11::integer, $12::smallint, $13::smallint, $14::uuid
           from unnest($9::date[]) as d
          where not exists (select 1 from public.pl_series_exceptions x where x.series_id = $8 and x.original_date = d)
         on conflict (series_id, original_date) do nothing`,
        [userId, s.type_id, s.start, s.end, s.next_day, s.amount, s.notes, s.id, dates, s.amount_kind, s.tax_rate_bp, s.pay_day, s.pay_month_offset, s.cnpj_id],
      );
      created += inserted.rowCount ?? 0;
    }
    await db.query("update public.pl_series set generated_until = $2::date where id = $1", [s.id, target]);
  }
  return created;
}

/** Leitura sem efeitos: há séries que ainda precisam gerar até `target`? */
export async function needsGeneration(user: AuthUser, target: CivilDate): Promise<boolean> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ pending: boolean }>(
      `select exists (
         select 1 from public.pl_series s join public.pl_types t on t.id = s.type_id and t.user_id = s.user_id
          where s.suspended_at is null and t.archived_at is null
            and (s.generated_until is null or s.generated_until < $1::date)
            and (s.end_date is null or s.generated_until is null or s.generated_until < s.end_date)
       ) as pending`,
      [target],
    );
    return rows[0]?.pending ?? false;
  });
}

/** Operação autenticada explícita (nunca na renderização): gera até o alvo, limitado ao horizonte máximo. */
export async function ensureGeneratedThrough(user: AuthUser, target: CivilDate): Promise<number> {
  return withUserContext(user, (db) => generateForUser(db, user.id, plGenerationWindow(target).target));
}

export async function listSeries(user: AuthUser): Promise<PlSeries[]> {
  return withUserContext(user, async (db) => {
    const today = todayInSaoPaulo();
    const { rows } = await db.query<SeriesRow & { next_date: string | null; upcoming: number }>(
      `select ${SERIES_COLUMNS},
              (select to_char(min(x.shift_date), 'YYYY-MM-DD') from public.pl_shifts x where x.series_id = s.id and x.status <> 'cancelado' and x.shift_date >= $1::date) as next_date,
              (select count(*)::int from public.pl_shifts x where x.series_id = s.id and x.status = 'agendado' and x.shift_date >= $1::date) as upcoming
         from public.pl_series s order by s.start_date desc, s.id`,
      [today],
    );
    return rows.map((r) => ({
      id: r.id,
      typeId: r.type_id,
      weekdays: weekdaysOf(r.weekday_mask),
      intervalWeeks: r.interval_weeks,
      startDate: r.start_date,
      endDate: r.end_date,
      amountCents: centsFromDb(r.amount),
      cnpjId: r.cnpj_id,
      taxRateBp: r.tax_rate_bp,
      payDay: r.pay_day,
      payMonthOffset: r.pay_month_offset,
      hours: r.start && r.end && r.next_day !== null ? { start: r.start, end: r.end, nextDay: r.next_day } : null,
      notes: r.notes,
      generatedUntil: r.generated_until,
      suspended: r.suspended,
      nextDate: r.next_date,
      upcoming: r.upcoming,
    }));
  });
}

async function insertSeries(db: PoolClient, userId: string, input: SeriesInput): Promise<string> {
  // Por CNPJ: alíquota informada (série anterior) ou o percentual do CNPJ agora.
  const rateBp = input.cnpjId ? (input.taxRateBp ?? (await cnpjRateIn(db, input.cnpjId))) : null;
  if (input.cnpjId && rateBp === null) throw new Abort("cnpj_not_found");
  let payDay = input.payDay;
  let payMonthOffset = input.payMonthOffset;
  if (payDay === undefined) {
    const type = await db.query<{ pay_day: number | null; pay_month_offset: 0 | 1 }>("select pay_day, pay_month_offset from public.pl_types where id = $1", [input.typeId]);
    payDay = type.rows[0]?.pay_day ?? null;
    payMonthOffset = type.rows[0]?.pay_month_offset ?? 1;
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, end_date, amount_cents, start_time, end_time, end_next_day, notes,
                                    amount_kind, tax_rate_bp, pay_day, pay_month_offset, cnpj_id)
     values ($1, $2, $3, $4, $5::date, $6::date, $7, $8::time, $9::time, $10, $11, $12, $13, $14, $15, $16) returning id`,
    [userId, input.typeId, maskOf(input.weekdays), input.intervalWeeks, input.startDate, input.endDate, input.amount, input.hours?.start ?? null, input.hours?.end ?? null, input.hours ? input.hours.nextDay : null, input.notes, kindOf(input.cnpjId), rateBp, payDay, payMonthOffset ?? 1, input.cnpjId],
  );
  return rows[0].id;
}

const horizon = () => plGenerationWindow(todayInSaoPaulo()).target;

export function createSeries(user: AuthUser, input: SeriesInput): Promise<MutationResult> {
  return run("series.create", user, async (db) => {
    const id = await insertSeries(db, user.id, input);
    const created = await generateForUser(db, user.id, horizon());
    await logEvent(db, user.id, { typeId: input.typeId, action: "serie_criada", details: { serie: id, inicio: input.startDate, geradas: created } });
    return { ok: true, id, count: created };
  });
}

export type SeriesImpact = { replaceCount: number; replaceFrom: CivilDate | null; replaceTo: CivilDate | null; preservedCount: number };

async function impactOf(db: PoolClient, seriesId: string, fromDate: CivilDate, inclusive = true): Promise<SeriesImpact> {
  const op = inclusive ? ">=" : ">";
  const { rows } = await db.query<{ n: number; first: string | null; last: string | null; kept: number }>(
    `select count(*) filter (where ${REPLACEABLE})::int as n,
            to_char(min(s.shift_date) filter (where ${REPLACEABLE}), 'YYYY-MM-DD') as first,
            to_char(max(s.shift_date) filter (where ${REPLACEABLE}), 'YYYY-MM-DD') as last,
            count(*) filter (where not ${REPLACEABLE} and s.status <> 'cancelado')::int as kept
       from public.pl_shifts s where s.series_id = $1 and s.original_date ${op} $2::date`,
    [seriesId, fromDate],
  );
  return { replaceCount: rows[0].n, replaceFrom: rows[0].first, replaceTo: rows[0].last, preservedCount: rows[0].kept };
}

/** Prévia (somente leitura) de editar/encerrar a série a partir de uma data. */
export async function seriesImpact(user: AuthUser, seriesId: string, fromDate: CivilDate, inclusive = true): Promise<SeriesImpact | null> {
  return withUserContext(user, async (db) => {
    const exists = await db.query("select 1 from public.pl_series where id = $1", [seriesId]);
    if (!exists.rowCount) return null;
    return impactOf(db, seriesId, fromDate, inclusive);
  });
}

/**
 * "Este e os próximos" / "futuras": encerra a série na véspera de `fromDate`, remove as substituíveis a
 * partir daí, cria a nova série, leva para ela as preservadas cuja data original existe na nova regra
 * (evita duplicar), copia as exceções e gera — tudo na mesma transação, com a série travada.
 */
async function split(db: PoolClient, userId: string, seriesId: string, fromDate: CivilDate, input: SeriesInput): Promise<{ newId: string; removed: number }> {
  const { rows } = await db.query<SeriesRow>(`select ${SERIES_COLUMNS} from public.pl_series s where s.id = $1 for update`, [seriesId]);
  const old = rows[0];
  if (!old) throw new Abort("not_found");
  await db.query("update public.pl_series set end_date = greatest($2::date, start_date - 1) where id = $1", [seriesId, addDays(fromDate, -1)]);
  const removed = await db.query(`delete from public.pl_shifts s where s.series_id = $1 and s.original_date >= $2::date and ${REPLACEABLE}`, [seriesId, fromDate]);
  // A nova série herda a regra de pagamento e, se continua no mesmo CNPJ, a alíquota da anterior.
  const newId = await insertSeries(db, userId, {
    ...input,
    typeId: old.type_id,
    taxRateBp: input.taxRateBp ?? (input.cnpjId !== null && input.cnpjId === old.cnpj_id ? old.tax_rate_bp : undefined),
    payDay: input.payDay !== undefined ? input.payDay : old.pay_day,
    payMonthOffset: input.payMonthOffset !== undefined ? input.payMonthOffset : old.pay_month_offset,
  });
  const preserved = await db.query<{ id: string; original_date: string }>(
    "select id, to_char(original_date, 'YYYY-MM-DD') as original_date from public.pl_shifts where series_id = $1 and original_date >= $2::date order by original_date",
    [seriesId, fromDate],
  );
  if (preserved.rows.length > 0) {
    const last = preserved.rows[preserved.rows.length - 1].original_date;
    const newDates = new Set(occurrencesBetween({ startDate: input.startDate, intervalWeeks: input.intervalWeeks, weekdays: input.weekdays, endDate: input.endDate }, input.startDate, last));
    const moving = preserved.rows.filter((p) => newDates.has(p.original_date)).map((p) => p.id);
    if (moving.length > 0) await db.query("update public.pl_shifts set series_id = $1 where id = any($2::uuid[])", [newId, moving]);
  }
  await db.query(
    `insert into public.pl_series_exceptions (series_id, user_id, original_date)
     select $1, $2, original_date from public.pl_series_exceptions where series_id = $3 and original_date >= $4::date
     on conflict do nothing`,
    [newId, userId, seriesId, fromDate],
  );
  const target = old.generated_until && old.generated_until > horizon() ? old.generated_until : horizon();
  await generateForUser(db, userId, target);
  return { newId, removed: removed.rowCount ?? 0 };
}

export function splitSeries(user: AuthUser, seriesId: string, fromDate: CivilDate, input: SeriesInput): Promise<MutationResult> {
  return run("series.split", user, async (db) => {
    const { newId, removed } = await split(db, user.id, seriesId, fromDate, input);
    await logEvent(db, user.id, { typeId: input.typeId, action: "serie_dividida", details: { serie: seriesId, nova_serie: newId, a_partir_de: fromDate, substituidas: removed } });
    return { ok: true, id: newId, count: removed };
  });
}

/** Encerra: nada é gerado depois de `endDate`; substituíveis posteriores são removidas. */
export function endSeries(user: AuthUser, seriesId: string, endDate: CivilDate): Promise<MutationResult> {
  return run("series.end", user, async (db) => {
    const { rows } = await db.query<{ type_id: string }>("update public.pl_series set end_date = greatest($2::date, start_date - 1) where id = $1 returning type_id", [seriesId, endDate]);
    if (!rows[0]) return { ok: false, reason: "not_found" };
    const removed = await db.query(`delete from public.pl_shifts s where s.series_id = $1 and s.original_date > $2::date and ${REPLACEABLE}`, [seriesId, endDate]);
    await logEvent(db, user.id, { typeId: rows[0].type_id, action: "serie_encerrada", details: { serie: seriesId, ate: endDate, removidas: removed.rowCount ?? 0 } });
    return { ok: true, count: removed.rowCount ?? 0 };
  });
}

/** Retoma uma série suspensa a partir de `fromDate` (o intervalo suspenso não é preenchido). */
export function resumeSeries(user: AuthUser, seriesId: string, fromDate: CivilDate): Promise<MutationResult> {
  return run("series.resume", user, async (db) => {
    const { rows } = await db.query<{ archived: boolean; type_id: string }>(
      `select t.archived_at is not null as archived, s.type_id from public.pl_series s join public.pl_types t on t.id = s.type_id
        where s.id = $1 and s.suspended_at is not null for update of s`,
      [seriesId],
    );
    if (!rows[0]) return { ok: false, reason: "not_found" };
    if (rows[0].archived) return { ok: false, reason: "type_archived" };
    await db.query(
      "update public.pl_series set suspended_at = null, generated_until = greatest(coalesce(generated_until, start_date - 1), $2::date - 1) where id = $1",
      [seriesId, fromDate],
    );
    const created = await generateForUser(db, user.id, horizon());
    await logEvent(db, user.id, { typeId: rows[0].type_id, action: "serie_retomada", details: { serie: seriesId, a_partir_de: fromDate } });
    return { ok: true, count: created };
  });
}

/**
 * Arquivar tipo com séries ativas exige confirmação: suspende as séries (sem novas gerações) e
 * preserva ocorrências e pagamentos. Restaurar NÃO retoma séries (retomada explícita, com data).
 */
export function setTypeArchivedWithSeries(user: AuthUser, typeId: string, archived: boolean, confirmed: boolean): Promise<MutationResult> {
  return run(archived ? "type.archive" : "type.restore", user, async (db) => {
    const t = await db.query("select 1 from public.pl_types where id = $1 and (archived_at is null) = $2 for update", [typeId, archived]);
    if (!t.rowCount) return { ok: false, reason: "not_found" };
    if (archived) {
      const active = await db.query<{ n: number }>(
        "select count(*)::int as n from public.pl_series where type_id = $1 and suspended_at is null and (end_date is null or end_date >= $2::date)",
        [typeId, todayInSaoPaulo()],
      );
      const n = active.rows[0].n;
      if (n > 0 && !confirmed) return { ok: false, reason: "needs_confirmation", count: n };
      await db.query("update public.pl_series set suspended_at = now() where type_id = $1 and suspended_at is null", [typeId]);
      await db.query("update public.pl_types set archived_at = now() where id = $1", [typeId]);
      await logEvent(db, user.id, { typeId, action: "tipo_arquivado", details: { series_suspensas: n } });
      return { ok: true, id: typeId, count: n };
    }
    await db.query("update public.pl_types set archived_at = null where id = $1", [typeId]);
    const suspended = await db.query<{ n: number }>("select count(*)::int as n from public.pl_series where type_id = $1 and suspended_at is not null", [typeId]);
    await logEvent(db, user.id, { typeId, action: "tipo_restaurado", details: {} });
    return { ok: true, id: typeId, count: suspended.rows[0].n };
  });
}

// ---------------------------------------------------------------------------
// Movimentação e troca
// ---------------------------------------------------------------------------

/**
 * Move UMA ocorrência (padrão para trocas): mesmo id, data original preservada (não reaparece),
 * registro de data anterior, nova data, observação e instante (gatilho).
 */
export function moveShift(user: AuthUser, shiftId: string, newDate: CivilDate, note: string | null): Promise<MutationResult> {
  return run("shift.move", user, async (db) => {
    const s = await lockShift(db, shiftId);
    if (!s) return { ok: false, reason: "not_found" };
    if (s.status === "cancelado") return { ok: false, reason: "locked" };
    if (s.date === newDate) return { ok: false, reason: "nothing_to_do" };
    await db.query("update public.pl_shifts set shift_date = $2::date where id = $1", [shiftId, newDate]);
    await logEvent(db, user.id, { shiftId, typeId: s.type_id, action: "movido", details: { de: s.date, para: newDate, observacao: note } });
    return { ok: true, id: shiftId };
  });
}

/**
 * Move "este e os próximos" (ou futuras): a série passa a cair `delta` dias depois (dias da semana
 * deslocados), dividida a partir da data original desta ocorrência (ou de hoje). Preservadas ficam.
 */
export function moveSeriesFrom(user: AuthUser, shiftId: string, newDate: CivilDate, note: string | null, scope: "proximas" | "futuras"): Promise<MutationResult> {
  return run("series.move", user, async (db) => {
    const { rows } = await db.query<{ series_id: string | null; original_date: string | null; date: string; type_id: string }>(
      "select series_id, to_char(original_date, 'YYYY-MM-DD') as original_date, to_char(shift_date, 'YYYY-MM-DD') as date, type_id from public.pl_shifts where id = $1 for update",
      [shiftId],
    );
    const s = rows[0];
    if (!s?.series_id || !s.original_date) return { ok: false, reason: "not_found" };
    const delta = daysBetween(s.date, newDate);
    if (delta === 0) return { ok: false, reason: "nothing_to_do" };
    if (Math.abs(delta) > 6) return { ok: false, reason: "locked", detail: "range" };
    const series = await db.query<SeriesRow>(`select ${SERIES_COLUMNS} from public.pl_series s where s.id = $1`, [s.series_id]);
    const old = series.rows[0];
    const fromDate = scope === "proximas" ? s.original_date : todayInSaoPaulo();
    const rule = ruleOf(old);
    const { newId, removed } = await split(db, user.id, s.series_id, fromDate, {
      typeId: old.type_id,
      weekdays: shiftWeekdays(rule.weekdays, delta),
      intervalWeeks: old.interval_weeks,
      // A ocorrência de fromDate passa a cair fromDate + delta (para frente ou para trás).
      startDate: addDays(fromDate, delta),
      endDate: old.end_date,
      amount: centsFromDb(old.amount),
      cnpjId: old.cnpj_id,
      hours: old.start && old.end && old.next_day !== null ? { start: old.start, end: old.end, nextDay: old.next_day } : null,
      notes: old.notes,
    });
    await logEvent(db, user.id, {
      shiftId: null,
      typeId: s.type_id,
      action: "serie_movida",
      details: { serie: s.series_id, nova_serie: newId, de: s.date, para: newDate, dias: delta, a_partir_de: fromDate, substituidas: removed, observacao: note },
    });
    return { ok: true, id: newId, count: removed };
  });
}
