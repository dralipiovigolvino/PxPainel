import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { todayInSaoPaulo, type CivilDate, type YearMonth } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import { monthRange } from "./domain/filters";
import type { PaymentMethod } from "./domain/payment";
import type { EntryInput } from "./domain/schemas";
import type { EntryStatus } from "./domain/status";
import { activeSeriesCount } from "./series-data";
import type { FinArea, FinEntry } from "./types";

export type { FinArea, FinEntry } from "./types";

export type FailureReason =
  | "not_found"
  | "duplicate_name"
  | "area_archived"
  | "invalid_area"
  | "has_entries"
  | "amount_unknown"
  | "needs_confirmation"
  | "installment_locked"
  | "nothing_to_cancel"
  | "invoice_paid"
  | "invoice_empty"
  | "card_archived"
  | "invalid_card"
  | "error";

/** `firstDue`: vencimento da primeira parcela criada (para o aviso dizer em que mês ela aparece). */
export type MutationResult = { ok: true; count?: number; firstDue?: CivilDate } | { ok: false; reason: FailureReason; count?: number };

type PgError = { code?: string; message?: string; constraint?: string };

/** Traduz erros do banco em motivos de negócio; registra só o código. */
export function toFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "23505" && e.constraint === "fin_areas_user_name_key") return { ok: false, reason: "duplicate_name" };
  if (e?.code === "P0001" && e.message === "fin_area_archived") return { ok: false, reason: "area_archived" };
  if (e?.code === "P0001" && e.message === "fin_installment_locked") return { ok: false, reason: "installment_locked" };
  if (e?.code === "P0001" && e.message === "fin_invoice_paid") return { ok: false, reason: "invoice_paid" };
  if (e?.code === "P0001" && e.message === "fin_card_archived") return { ok: false, reason: "card_archived" };
  if (e?.code === "23514" && e.constraint === "fin_entries_amount_required_check") return { ok: false, reason: "amount_unknown" };
  // Excluir área com vínculos: ON DELETE RESTRICT gera 23001 (restrict_violation).
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint?.endsWith("area_fkey")) {
    return { ok: false, reason: operation === "area.delete" ? "has_entries" : "invalid_area" };
  }
  console.error(`[Meu Painel] financas/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

// ---------------------------------------------------------------------------
// Leituras (lançam erro em caso de falha: a tela mostra erro, nunca lista vazia falsa)
// ---------------------------------------------------------------------------

export async function listAreas(user: AuthUser): Promise<FinArea[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; color: string; archived: boolean; entry_count: number; active_series: number }>(
      `select a.id, a.name, a.color, a.archived_at is not null as archived,
              (select count(*)::int from public.fin_entries e where e.area_id = a.id)
                + (select count(*)::int from public.fin_series s where s.area_id = a.id)
                + (select count(*)::int from public.fin_installment_plans p where p.area_id = a.id) as entry_count,
              (select count(*)::int from public.fin_series s
                where s.area_id = a.id and s.suspended_at is null and (s.end_date is null or s.end_date >= $1::date)) as active_series
         from public.fin_areas a
        order by (a.archived_at is not null), lower(a.name), a.id`,
      [todayInSaoPaulo()],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      archived: r.archived,
      entryCount: r.entry_count,
      activeSeries: r.active_series,
    }));
  });
}

type EntryRow = {
  id: string;
  area_id: string;
  description: string;
  amount_cents: string | null;
  due_date: string;
  category: string | null;
  notes: string | null;
  status: EntryStatus;
  paid_on: string | null;
  series_id: string | null;
  occurrence_date: string | null;
  is_override: boolean;
  is_variable: boolean;
  installment_plan_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  payment_method: PaymentMethod | null;
};

export const ENTRY_COLUMNS = `e.id, e.area_id, e.description, e.amount_cents::text as amount_cents,
  to_char(e.due_date, 'YYYY-MM-DD') as due_date, e.category, e.notes, e.status,
  to_char(e.paid_on, 'YYYY-MM-DD') as paid_on, e.series_id, to_char(e.occurrence_date, 'YYYY-MM-DD') as occurrence_date,
  e.is_override, e.is_variable, e.installment_plan_id, e.installment_number, e.payment_method,
  (select p.installments_count from public.fin_installment_plans p where p.id = e.installment_plan_id)::int as installment_count`;

export function mapEntry(r: EntryRow): FinEntry {
  return {
    id: r.id,
    areaId: r.area_id,
    description: r.description,
    amountCents: r.amount_cents === null ? null : centsFromDb(r.amount_cents),
    dueDate: r.due_date,
    category: r.category,
    notes: r.notes,
    status: r.status,
    paidOn: r.paid_on,
    seriesId: r.series_id,
    occurrenceDate: r.occurrence_date,
    isOverride: r.is_override,
    isVariable: r.is_variable,
    installmentPlanId: r.installment_plan_id,
    installmentNumber: r.installment_number,
    installmentCount: r.installment_count,
    paymentMethod: r.payment_method,
  };
}

/** Contas (fora do cartão) com vencimento no mês, de todas as áreas, em ordem estável. Canceladas ficam fora. */
export async function listMonthEntries(user: AuthUser, filters: { month: YearMonth }): Promise<FinEntry[]> {
  const { from, to } = monthRange(filters.month);
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<EntryRow>(
      `select ${ENTRY_COLUMNS}
         from public.fin_entries e
        where e.due_date between $1::date and $2::date
          and e.status <> 'cancelado'
        order by e.due_date, e.created_at, e.id`,
      [from, to],
    );
    return rows.map(mapEntry);
  });
}

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

async function run(operation: string, user: AuthUser, sql: string, params: unknown[]): Promise<MutationResult> {
  try {
    const count = await withUserContext(user, async (db) => (await db.query(sql, params)).rowCount ?? 0);
    return count > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return toFailure(operation, error);
  }
}

export function createArea(user: AuthUser, input: { name: string; color: string }) {
  return run("area.create", user, "insert into public.fin_areas (user_id, name, color) values ($1, $2, $3)", [
    user.id,
    input.name,
    input.color,
  ]);
}

export function updateArea(user: AuthUser, id: string, input: { name: string; color: string }) {
  return run("area.update", user, "update public.fin_areas set name = $2, color = $3 where id = $1", [id, input.name, input.color]);
}

/**
 * Arquivar suspende a geração das séries ativas da área (exige confirmação explícita
 * quando há séries). Restaurar NÃO reativa séries: a retomada é explícita, com data.
 */
export async function setAreaArchived(user: AuthUser, id: string, archived: boolean, confirmedSeries = false): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      if (!archived) {
        const r = await db.query("update public.fin_areas set archived_at = null where id = $1 and archived_at is not null", [id]);
        if (!r.rowCount) return { ok: false, reason: "not_found" };
        const suspended = await db.query<{ n: number }>(
          "select count(*)::int as n from public.fin_series where area_id = $1 and suspended_at is not null and ended_at is null",
          [id],
        );
        return { ok: true, count: suspended.rows[0]?.n ?? 0 };
      }
      const lock = await db.query("select 1 from public.fin_areas where id = $1 and archived_at is null for update", [id]);
      if (!lock.rowCount) return { ok: false, reason: "not_found" };
      const series = await activeSeriesCount(db, id, todayInSaoPaulo());
      if (series > 0 && !confirmedSeries) return { ok: false, reason: "needs_confirmation", count: series };
      await db.query("update public.fin_areas set archived_at = now() where id = $1", [id]);
      await db.query("update public.fin_series set suspended_at = now() where area_id = $1 and suspended_at is null", [id]);
      return { ok: true };
    });
  } catch (error) {
    return toFailure(archived ? "area.archive" : "area.restore", error);
  }
}

/** Só apaga áreas sem lançamentos nem séries: as FKs com RESTRICT recusam mesmo sob concorrência. */
export function deleteArea(user: AuthUser, id: string) {
  return run("area.delete", user, "delete from public.fin_areas where id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

/** Forma de pagamento ausente = não informada (null). */
export function createEntry(user: AuthUser, input: Omit<EntryInput, "paymentMethod"> & { paymentMethod?: PaymentMethod | null }) {
  return run(
    "entry.create",
    user,
    `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, category, notes, payment_method)
     values ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
    [user.id, input.areaId, input.description, input.amountCents, input.dueDate, input.category, input.notes, input.paymentMethod ?? null],
  );
}

/**
 * Edita dados da conta. Status e data de pagamento NÃO mudam aqui.
 * Numa ocorrência de série, a edição vale "somente para esta" e a marca como personalizada:
 * ela deixa de ser substituída por alterações futuras da série e nunca é recriada
 * (a identidade é a data original, que não muda).
 */
export function updateEntry(user: AuthUser, id: string, input: Omit<EntryInput, "amountCents"> & { amountCents: number | null }) {
  return run(
    "entry.update",
    user,
    `update public.fin_entries
        set area_id = $2, description = $3, amount_cents = $4, due_date = $5::date, category = $6, notes = $7,
            payment_method = $8, is_override = (series_id is not null)
      where id = $1`,
    [id, input.areaId, input.description, input.amountCents, input.dueDate, input.category, input.notes, input.paymentMethod],
  );
}

/** Informa ou corrige o valor de uma ocorrência variável (não a marca como personalizada). */
export function setOccurrenceAmount(user: AuthUser, id: string, amountCents: number | null) {
  return run("entry.amount", user, "update public.fin_entries set amount_cents = $2 where id = $1 and is_variable", [id, amountCents]);
}

/** Exclui a conta. Se for ocorrência de série, grava a exceção para ela não reaparecer. */
export async function deleteEntry(user: AuthUser, id: string): Promise<MutationResult> {
  try {
    const found = await withUserContext(user, async (db) => {
      const { rows } = await db.query<{ series_id: string | null; occurrence_date: string | null }>(
        "delete from public.fin_entries where id = $1 returning series_id, to_char(occurrence_date, 'YYYY-MM-DD') as occurrence_date",
        [id],
      );
      if (!rows[0]) return false;
      if (rows[0].series_id) {
        await db.query(
          `insert into public.fin_series_exceptions (series_id, user_id, occurrence_date) values ($1, $2, $3::date)
           on conflict do nothing`,
          [rows[0].series_id, user.id, rows[0].occurrence_date],
        );
      }
      return true;
    });
    return found ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return toFailure("entry.delete", error);
  }
}

export function markEntryPaid(user: AuthUser, id: string, paidOn: CivilDate) {
  return run("entry.pay", user, "update public.fin_entries set status = 'pago', paid_on = $2::date where id = $1", [id, paidOn]);
}

export function markEntryPending(user: AuthUser, id: string) {
  return run("entry.unpay", user, "update public.fin_entries set status = 'pendente', paid_on = null where id = $1", [id]);
}
