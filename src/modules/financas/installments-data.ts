import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { todayInSaoPaulo, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { bigintFromDb, centsFromDb } from "@/lib/money";
import { toFailure, type MutationResult } from "./data";
import type { PaymentMethod } from "./domain/payment";
import { installmentDates, splitCents } from "./domain/installments";
import type { FinPlan } from "./types";

export type { FinPlan } from "./types";

export type PlanInput = {
  areaId: string;
  description: string;
  category: string | null;
  notes: string | null;
  totalCents: number;
  count: number;
  firstDueDate: CivilDate;
  requestId: string;
  /** Ausente = não informada. */
  paymentMethod?: PaymentMethod | null;
};

/**
 * Cria o plano e TODAS as parcelas numa transação. O gatilho adiado do banco confere, no
 * commit, que há exatamente N parcelas somando o total. Reenvio com o mesmo requestId não
 * cria outro plano (ON CONFLICT DO NOTHING) e é tratado como sucesso.
 */
export async function createInstallmentPlan(user: AuthUser, input: PlanInput): Promise<MutationResult> {
  const parts = splitCents(input.totalCents, input.count);
  const dates = installmentDates(input.firstDueDate, input.count);
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.fin_installment_plans
           (user_id, area_id, description, category, notes, total_cents, installments_count, first_due_date, request_id, payment_method)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10)
         on conflict (user_id, request_id) do nothing
         returning id`,
        [user.id, input.areaId, input.description, input.category, input.notes, input.totalCents, input.count, input.firstDueDate, input.requestId, input.paymentMethod ?? null],
      );
      if (!rows[0]) return { ok: true, count: 0 }; // já criado por um envio anterior
      await db.query(
        `insert into public.fin_entries
           (user_id, area_id, description, amount_cents, due_date, category, notes, installment_plan_id, installment_number, payment_method)
         select $1, $2, $3, a, d, $4, $5, $6, n, $10
           from unnest($7::bigint[], $8::date[], $9::smallint[]) as t(a, d, n)`,
        [user.id, input.areaId, input.description, input.category, input.notes, rows[0].id, parts, dates, parts.map((_, i) => i + 1), input.paymentMethod ?? null],
      );
      return { ok: true, count: input.count };
    });
  } catch (error) {
    return toFailure("plan.create", error);
  }
}

export async function listPlans(user: AuthUser): Promise<FinPlan[]> {
  const today = todayInSaoPaulo();
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{
      id: string;
      area_id: string;
      description: string;
      category: string | null;
      total_cents: string;
      installments_count: number;
      first_due_date: string;
      canceled_at: string | null;
      paid_count: number;
      paid_cents: string;
      pending_count: number;
      pending_cents: string;
      canceled_count: number;
      canceled_cents: string;
      overdue_count: number;
      next_due: string | null;
      payment_method: PaymentMethod | null;
    }>(
      `select p.id, p.area_id, p.description, p.category, p.total_cents::text as total_cents, p.installments_count,
              to_char(p.first_due_date, 'YYYY-MM-DD') as first_due_date, p.canceled_at::text as canceled_at, p.payment_method,
              count(*) filter (where e.status = 'pago')::int as paid_count,
              coalesce(sum(e.amount_cents) filter (where e.status = 'pago'), 0)::text as paid_cents,
              count(*) filter (where e.status = 'pendente')::int as pending_count,
              coalesce(sum(e.amount_cents) filter (where e.status = 'pendente'), 0)::text as pending_cents,
              count(*) filter (where e.status = 'cancelado')::int as canceled_count,
              coalesce(sum(e.amount_cents) filter (where e.status = 'cancelado'), 0)::text as canceled_cents,
              count(*) filter (where e.status = 'pendente' and e.due_date < $1::date)::int as overdue_count,
              to_char(min(e.due_date) filter (where e.status = 'pendente'), 'YYYY-MM-DD') as next_due
         from public.fin_installment_plans p
         left join public.fin_entries e on e.installment_plan_id = p.id
        group by p.id
        order by (count(*) filter (where e.status = 'pendente') = 0), min(e.due_date) filter (where e.status = 'pendente'), p.created_at, p.id`,
      [today],
    );
    return rows.map((r) => ({
      id: r.id,
      areaId: r.area_id,
      description: r.description,
      category: r.category,
      totalCents: centsFromDb(r.total_cents),
      count: r.installments_count,
      firstDueDate: r.first_due_date,
      canceled: r.canceled_at !== null,
      paidCount: r.paid_count,
      paidCents: bigintFromDb(r.paid_cents).toString(),
      pendingCount: r.pending_count,
      pendingCents: bigintFromDb(r.pending_cents).toString(),
      canceledCount: r.canceled_count,
      canceledCents: bigintFromDb(r.canceled_cents).toString(),
      overdueCount: r.overdue_count,
      nextDue: r.next_due,
      paymentMethod: r.payment_method,
    }));
  });
}

/** Prévia do cancelamento: parcelas pendentes e seu total. */
export async function previewCancelPlan(user: AuthUser, planId: string): Promise<{ count: number; cents: string } | null> {
  return withUserContext(user, async (db) => {
    const exists = await db.query("select 1 from public.fin_installment_plans where id = $1", [planId]);
    if (!exists.rowCount) return null;
    const { rows } = await db.query<{ n: number; s: string }>(
      "select count(*)::int as n, coalesce(sum(amount_cents), 0)::text as s from public.fin_entries where installment_plan_id = $1 and status = 'pendente'",
      [planId],
    );
    return { count: rows[0].n, cents: rows[0].s };
  });
}

/**
 * Cancela as parcelas PENDENTES (pagas ficam). Registra no plano e em fin_events.
 * Canceladas saem de totais e projeções; não é pagamento.
 */
export async function cancelPendingInstallments(user: AuthUser, planId: string): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const lock = await db.query("select 1 from public.fin_installment_plans where id = $1 for update", [planId]);
      if (!lock.rowCount) return { ok: false, reason: "not_found" };
      const { rows } = await db.query<{ amount_cents: string; installment_number: number }>(
        `update public.fin_entries set status = 'cancelado'
          where installment_plan_id = $1 and status = 'pendente'
          returning amount_cents::text as amount_cents, installment_number`,
        [planId],
      );
      if (rows.length === 0) return { ok: false, reason: "nothing_to_cancel" };
      const total = rows.reduce((acc, r) => acc + BigInt(r.amount_cents), 0n);
      await db.query(
        "update public.fin_installment_plans set canceled_at = now(), canceled_count = coalesce(canceled_count, 0) + $2 where id = $1",
        [planId, rows.length],
      );
      await db.query(
        `insert into public.fin_events (user_id, entity_type, entity_id, action, details)
         values ($1, 'plano', $2, 'cancelamento', $3::jsonb)`,
        [user.id, planId, JSON.stringify({ parcelas: rows.map((r) => r.installment_number).sort((a, b) => a - b), total_cents: total.toString() })],
      );
      return { ok: true, count: rows.length };
    });
  } catch (error) {
    return toFailure("plan.cancel", error);
  }
}

/** Edição permitida de uma parcela: textos, forma de pagamento e (se pendente) vencimento. Valor e área são fixos. */
export async function updateInstallmentEntry(
  user: AuthUser,
  id: string,
  input: { description: string; category: string | null; notes: string | null; dueDate: CivilDate; paymentMethod: PaymentMethod | null },
): Promise<MutationResult> {
  try {
    const count = await withUserContext(user, async (db) =>
      (
        await db.query(
          `update public.fin_entries set description = $2, category = $3, notes = $4, due_date = $5::date, payment_method = $6
            where id = $1 and installment_plan_id is not null`,
          [id, input.description, input.category, input.notes, input.dueDate, input.paymentMethod],
        )
      ).rowCount ?? 0,
    );
    return count > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return toFailure("installment.update", error);
  }
}

/**
 * Forma de pagamento do parcelamento: grava no plano e nas parcelas PENDENTES (pagas e canceladas
 * ficam como estão). Retorna quantas parcelas mudaram.
 */
export async function setPlanPaymentMethod(user: AuthUser, planId: string, method: PaymentMethod): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const plan = await db.query("update public.fin_installment_plans set payment_method = $2 where id = $1", [planId, method]);
      if (!plan.rowCount) return { ok: false, reason: "not_found" };
      const entries = await db.query(
        "update public.fin_entries set payment_method = $2 where installment_plan_id = $1 and status = 'pendente'",
        [planId, method],
      );
      return { ok: true, count: entries.rowCount ?? 0 };
    });
  } catch (error) {
    return toFailure("plan.payment", error);
  }
}
