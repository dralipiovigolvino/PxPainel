import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { bigintFromDb } from "@/lib/money";
import { queryCardCharges, queryInvoices } from "./cards-data";
import type { AnalyticsItem } from "./domain/analytics";
import type { PaymentMethod } from "./domain/payment";

/**
 * Base da Visão geral no intervalo: contas fora do cartão (sem canceladas) e faturas de cartão pelo
 * vencimento. Cada fatura vira as suas compras cadastradas mais um item com a parte sem compra
 * cadastrada (total considerado − compras), todos com a situação da fatura: a soma é o total dela.
 * Recorrências: só ocorrências MATERIALIZADAS (a tela pede a geração antes), então a mesma
 * ocorrência nunca é contada duas vezes.
 */
export async function listOverviewItems(user: AuthUser, from: CivilDate, to: CivilDate): Promise<AnalyticsItem[]> {
  return withUserContext(user, async (db) => {
    const entries = await db.query<{
      id: string;
      description: string;
      due_date: string;
      status: "pendente" | "pago";
      amount_cents: string | null;
      area_id: string;
      category: string | null;
      payment_method: PaymentMethod | null;
    }>(
      `select e.id, e.description, to_char(e.due_date, 'YYYY-MM-DD') as due_date, e.status, e.amount_cents::text as amount_cents,
              e.area_id, e.category, e.payment_method
         from public.fin_entries e
        where e.due_date between $1::date and $2::date and e.status <> 'cancelado'
        order by e.due_date, e.created_at, e.id`,
      [from, to],
    );
    const invoices = await queryInvoices(db, from, to);
    const charges = await queryCardCharges(db, from, to);
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    return [
      ...entries.rows.map(
        (r): AnalyticsItem => ({
          source: "conta",
          id: r.id,
          description: r.description,
          dueDate: r.due_date,
          areaId: r.area_id,
          category: r.category,
          cents: r.amount_cents === null ? null : bigintFromDb(r.amount_cents),
          status: r.status,
          paymentMethod: r.payment_method,
          cardId: null,
        }),
      ),
      ...charges.map(
        (c): AnalyticsItem => ({
          source: "cartao",
          id: c.id,
          description: c.description,
          dueDate: c.dueDate,
          areaId: c.areaId,
          category: c.category,
          cents: BigInt(c.amountCents),
          status: invoiceById.get(c.invoiceId)?.status ?? "pendente",
          paymentMethod: null,
          cardId: c.cardId,
        }),
      ),
      ...invoices
        .filter((i) => i.totalCents !== i.detailedCents)
        .map(
          (i): AnalyticsItem => ({
            source: "cartao",
            id: `resto:${i.id}`,
            description: `${i.cardName}: ${i.totalCents > i.detailedCents ? "outros valores da fatura" : "ajuste da fatura"}`,
            dueDate: i.dueDate,
            areaId: null,
            category: null,
            cents: BigInt(i.totalCents - i.detailedCents),
            status: i.status,
            paymentMethod: null,
            cardId: i.cardId,
            undetailed: true,
          }),
        ),
    ];
  });
}

/** Categorias usadas (contas e compras), para o filtro. */
export async function listCategories(user: AuthUser): Promise<string[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ category: string }>(
      `select min(category) as category from (
         select category from public.fin_entries where category is not null
         union all
         select category from public.fin_card_purchases where category is not null
       ) c group by lower(category) order by lower(min(category))`,
    );
    return rows.map((r) => r.category);
  });
}
