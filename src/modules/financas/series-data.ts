import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, addMonths, clampedDate, daysInMonth, todayInSaoPaulo, yearMonthOf, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { MutationResult } from "./data";
import type { PaymentMethod } from "./domain/payment";
import type { FinSeries, SeriesImpact } from "./types";

export type { FinSeries, SeriesImpact } from "./types";
import { DEFAULT_HORIZON_MONTHS, MAX_HORIZON_MONTHS, occurrencesBetween, type Frequency, type RecurrenceRule } from "./domain/recurrence";

// ---------------------------------------------------------------------------
// Horizonte de geração
// ---------------------------------------------------------------------------

/** Último dia do mês que fica `months` meses depois de hoje (São Paulo). */
export function horizonDate(months = DEFAULT_HORIZON_MONTHS, today = todayInSaoPaulo()): CivilDate {
  const ym = addMonths(yearMonthOf(today), months);
  return clampedDate(ym, daysInMonth(ym.year, ym.month));
}

/** Alvo pedido pela interface, limitado a um máximo seguro. */
export function clampTarget(target: CivilDate): CivilDate {
  const max = horizonDate(MAX_HORIZON_MONTHS);
  const min = horizonDate(DEFAULT_HORIZON_MONTHS);
  return target > max ? max : target < min ? min : target;
}

const REPLACEABLE = `(e.status = 'pendente' and not e.is_override and not (e.is_variable and e.amount_cents is not null))`;

type SeriesRow = {
  id: string;
  area_id: string;
  description: string;
  category: string | null;
  notes: string | null;
  amount_kind: "fixo" | "variavel";
  amount_cents: string | null;
  frequency: Frequency;
  interval_months: number;
  start_date: string;
  end_date: string | null;
  generated_until: string | null;
  payment_method: PaymentMethod | null;
};

const SERIES_COLUMNS = `s.id, s.area_id, s.description, s.category, s.notes, s.amount_kind, s.amount_cents::text as amount_cents,
  s.frequency, s.interval_months, to_char(s.start_date, 'YYYY-MM-DD') as start_date,
  to_char(s.end_date, 'YYYY-MM-DD') as end_date, to_char(s.generated_until, 'YYYY-MM-DD') as generated_until, s.payment_method`;

const ruleOf = (s: SeriesRow): RecurrenceRule => ({
  startDate: s.start_date,
  frequency: s.frequency,
  intervalMonths: s.interval_months,
  endDate: s.end_date,
});

/**
 * Materializa as ocorrências de todas as séries elegíveis do usuário até `target`.
 * - Elegível: não suspensa, área ativa, ainda não gerada até o alvo.
 * - Idempotente: UNIQUE (series_id, occurrence_date) + ON CONFLICT DO NOTHING.
 * - Serializada: FOR UPDATE nas séries (ordem por id evita impasse entre transações).
 * - Exceções (ocorrências excluídas) nunca são recriadas.
 * Deve rodar dentro de withUserContext (mesma transação da operação que a chamou).
 */
export async function generateForUser(db: PoolClient, userId: string, target: CivilDate): Promise<number> {
  const { rows } = await db.query<SeriesRow>(
    `select ${SERIES_COLUMNS}
       from public.fin_series s
       join public.fin_areas a on a.id = s.area_id and a.user_id = s.user_id
      where s.suspended_at is null
        and a.archived_at is null
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
        `insert into public.fin_entries
           (user_id, area_id, description, amount_cents, due_date, category, notes, series_id, occurrence_date, is_variable, payment_method)
         select $1, $2, $3, $4::bigint, d, $5, $6, $7, d, $8, $10
           from unnest($9::date[]) as d
          where not exists (
            select 1 from public.fin_series_exceptions x where x.series_id = $7 and x.occurrence_date = d
          )
         on conflict (series_id, occurrence_date) do nothing`,
        [userId, s.area_id, s.description, s.amount_cents, s.category, s.notes, s.id, s.amount_kind === "variavel", dates, s.payment_method],
      );
      created += inserted.rowCount ?? 0;
    }
    await db.query("update public.fin_series set generated_until = $2::date where id = $1", [s.id, target]);
  }
  return created;
}

/** Leitura sem efeitos: há séries que ainda precisam gerar até `target`? */
export async function needsGeneration(user: AuthUser, target: CivilDate): Promise<boolean> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ pending: boolean }>(
      `select exists (
         select 1 from public.fin_series s join public.fin_areas a on a.id = s.area_id and a.user_id = s.user_id
          where s.suspended_at is null and a.archived_at is null
            and (s.generated_until is null or s.generated_until < $1::date)
            and (s.end_date is null or s.generated_until is null or s.generated_until < s.end_date)
            and (s.end_date is null or s.start_date <= s.end_date)
       ) as pending`,
      [target],
    );
    return rows[0]?.pending ?? false;
  });
}

export async function ensureGeneratedThrough(user: AuthUser, target: CivilDate): Promise<number> {
  return withUserContext(user, (db) => generateForUser(db, user.id, clampTarget(target)));
}

// ---------------------------------------------------------------------------
// Consulta de séries
// ---------------------------------------------------------------------------


export async function listSeries(user: AuthUser): Promise<FinSeries[]> {
  const today = todayInSaoPaulo();
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<SeriesRow & { suspended: boolean; ended_at: string | null; next_due: string | null; pending_count: number }>(
      `select ${SERIES_COLUMNS}, s.suspended_at is not null as suspended, s.ended_at::text as ended_at,
              (select to_char(min(e.due_date), 'YYYY-MM-DD') from public.fin_entries e
                where e.series_id = s.id and e.status = 'pendente' and e.due_date >= $1::date) as next_due,
              (select count(*)::int from public.fin_entries e where e.series_id = s.id and e.status = 'pendente') as pending_count
         from public.fin_series s
        order by lower(s.description), s.start_date, s.id`,
      [today],
    );
    return rows.map((s) => ({
      id: s.id,
      areaId: s.area_id,
      description: s.description,
      category: s.category,
      notes: s.notes,
      amountKind: s.amount_kind,
      amountCents: s.amount_cents === null ? null : centsFromDb(s.amount_cents),
      frequency: s.frequency,
      intervalMonths: s.interval_months,
      startDate: s.start_date,
      endDate: s.end_date,
      generatedUntil: s.generated_until,
      suspended: s.suspended,
      ended: Boolean(s.ended_at) || (s.end_date !== null && s.end_date < today),
      nextDue: s.next_due,
      pendingCount: s.pending_count,
      paymentMethod: s.payment_method,
    }));
  });
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export type SeriesInput = {
  areaId: string;
  description: string;
  category: string | null;
  notes: string | null;
  amountKind: "fixo" | "variavel";
  amountCents: number | null;
  frequency: Frequency;
  intervalMonths: number;
  startDate: CivilDate;
  endDate: CivilDate | null;
  /** Ausente = não informada. */
  paymentMethod?: PaymentMethod | null;
};

async function insertSeries(db: PoolClient, userId: string, input: SeriesInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.fin_series
       (user_id, area_id, description, category, notes, amount_kind, amount_cents, frequency, interval_months, start_date, end_date, payment_method)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12)
     returning id`,
    [
      userId,
      input.areaId,
      input.description,
      input.category,
      input.notes,
      input.amountKind,
      input.amountKind === "fixo" ? input.amountCents : null,
      input.frequency,
      input.frequency === "mensal" ? input.intervalMonths : 1,
      input.startDate,
      input.endDate,
      input.paymentMethod ?? null,
    ],
  );
  return rows[0].id;
}

type PgError = { code?: string; message?: string; constraint?: string };

function seriesFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "P0001" && e.message === "fin_area_archived") return { ok: false, reason: "area_archived" };
  if (e?.code === "23503" && e.constraint?.endsWith("area_fkey")) return { ok: false, reason: "invalid_area" };
  console.error(`[Meu Painel] financas/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

/** Cria a série e gera as ocorrências até o horizonte padrão, na mesma transação. */
export async function createSeries(user: AuthUser, input: SeriesInput): Promise<MutationResult> {
  try {
    await withUserContext(user, async (db) => {
      await insertSeries(db, user.id, input);
      await generateForUser(db, user.id, horizonDate());
    });
    return { ok: true };
  } catch (error) {
    return seriesFailure("series.create", error);
  }
}

// ---------------------------------------------------------------------------
// Prévia, divisão ("esta e as próximas" / "futuras") e encerramento
// ---------------------------------------------------------------------------


export async function seriesImpact(user: AuthUser, seriesId: string, fromDate: CivilDate): Promise<SeriesImpact | null> {
  return withUserContext(user, async (db) => {
    const exists = await db.query("select 1 from public.fin_series where id = $1", [seriesId]);
    if (!exists.rowCount) return null;
    const { rows } = await db.query<{ replace_count: number; replace_from: string | null; replace_to: string | null; preserved_count: number }>(
      `select count(*) filter (where ${REPLACEABLE})::int as replace_count,
              to_char(min(e.occurrence_date) filter (where ${REPLACEABLE}), 'YYYY-MM-DD') as replace_from,
              to_char(max(e.occurrence_date) filter (where ${REPLACEABLE}), 'YYYY-MM-DD') as replace_to,
              count(*) filter (where not ${REPLACEABLE})::int as preserved_count
         from public.fin_entries e
        where e.series_id = $1 and e.occurrence_date >= $2::date`,
      [seriesId, fromDate],
    );
    const r = rows[0];
    return { replaceCount: r.replace_count, replaceFrom: r.replace_from, replaceTo: r.replace_to, preservedCount: r.preserved_count };
  });
}

/**
 * Aplica uma nova regra a partir de `fromDate` (inclusive), numa única transação:
 * encerra a série antiga na véspera, remove as pendentes substituíveis a partir da data,
 * cria a nova série, leva as preservadas cuja data existe na nova regra, copia as exceções
 * e gera as novas ocorrências. Pagas, personalizadas e passado ficam intactos.
 */
export async function splitSeries(user: AuthUser, seriesId: string, fromDate: CivilDate, input: SeriesInput): Promise<MutationResult> {
  try {
    const result = await withUserContext(user, async (db) => {
      const { rows } = await db.query<SeriesRow>(`select ${SERIES_COLUMNS} from public.fin_series s where s.id = $1 for update`, [seriesId]);
      const old = rows[0];
      if (!old) return false;

      await db.query("update public.fin_series set end_date = $2::date where id = $1", [seriesId, addDays(fromDate, -1)]);
      await db.query(`delete from public.fin_entries e where e.series_id = $1 and e.occurrence_date >= $2::date and ${REPLACEABLE}`, [seriesId, fromDate]);

      const newId = await insertSeries(db, user.id, input);

      const preserved = await db.query<{ id: string; occurrence_date: string }>(
        `select id, to_char(occurrence_date, 'YYYY-MM-DD') as occurrence_date from public.fin_entries
          where series_id = $1 and occurrence_date >= $2::date order by occurrence_date`,
        [seriesId, fromDate],
      );
      if (preserved.rows.length > 0) {
        const last = preserved.rows[preserved.rows.length - 1].occurrence_date;
        const newDates = new Set(occurrencesBetween({ ...input, endDate: input.endDate }, input.startDate, last));
        const moving = preserved.rows.filter((p) => newDates.has(p.occurrence_date)).map((p) => p.id);
        if (moving.length > 0) {
          await db.query("update public.fin_entries set series_id = $1 where id = any($2::uuid[])", [newId, moving]);
        }
      }

      await db.query(
        `insert into public.fin_series_exceptions (series_id, user_id, occurrence_date)
         select $1, $2, occurrence_date from public.fin_series_exceptions where series_id = $3 and occurrence_date >= $4::date
         on conflict do nothing`,
        [newId, user.id, seriesId, fromDate],
      );

      const target = old.generated_until && old.generated_until > horizonDate() ? old.generated_until : horizonDate();
      await generateForUser(db, user.id, target);
      return true;
    });
    return result ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return seriesFailure("series.split", error);
  }
}

/** Encerra: nada é gerado após `endDate`; pendentes substituíveis posteriores são removidas. */
export async function endSeries(user: AuthUser, seriesId: string, endDate: CivilDate): Promise<MutationResult> {
  try {
    const found = await withUserContext(user, async (db) => {
      const upd = await db.query("update public.fin_series set end_date = $2::date, ended_at = now() where id = $1", [seriesId, endDate]);
      if (!upd.rowCount) return false;
      await db.query(`delete from public.fin_entries e where e.series_id = $1 and e.occurrence_date > $2::date and ${REPLACEABLE}`, [seriesId, endDate]);
      return true;
    });
    return found ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return seriesFailure("series.end", error);
  }
}

/** Retoma uma série suspensa a partir de `fromDate` (sem preencher o intervalo suspenso). */
export async function resumeSeries(user: AuthUser, seriesId: string, fromDate: CivilDate): Promise<MutationResult> {
  try {
    const outcome = await withUserContext(user, async (db) => {
      const { rows } = await db.query<{ archived: boolean }>(
        `select a.archived_at is not null as archived from public.fin_series s
           join public.fin_areas a on a.id = s.area_id and a.user_id = s.user_id
          where s.id = $1 and s.suspended_at is not null for update of s`,
        [seriesId],
      );
      if (!rows[0]) return "not_found" as const;
      if (rows[0].archived) return "area_archived" as const;
      await db.query(
        `update public.fin_series
            set suspended_at = null,
                generated_until = greatest(coalesce(generated_until, start_date - 1), $2::date - 1)
          where id = $1`,
        [seriesId, fromDate],
      );
      await generateForUser(db, user.id, horizonDate());
      return "ok" as const;
    });
    return outcome === "ok" ? { ok: true } : { ok: false, reason: outcome };
  } catch (error) {
    return seriesFailure("series.resume", error);
  }
}

/** Séries ativas (não suspensas, não encerradas) de uma área — para confirmar o arquivamento. */
export async function activeSeriesCount(db: PoolClient, areaId: string, today: CivilDate): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from public.fin_series
      where area_id = $1 and suspended_at is null and (end_date is null or end_date >= $2::date)`,
    [areaId, today],
  );
  return rows[0]?.n ?? 0;
}
