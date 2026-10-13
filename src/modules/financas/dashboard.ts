import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { DashboardItem, DashboardModuleData } from "@/modules/dashboard/contract";
import { queryInvoices } from "./cards-data";
import { PAYMENT_LABELS, type PaymentMethod } from "./domain/payment";
import { generationWindow } from "./domain/recurrence";
import { needsGeneration } from "./series-data";

/**
 * Finanças no dashboard: contas PENDENTES (fora do cartão) e faturas de cartão A PAGAR com vencimento
 * até hoje + 7, inclusive atrasadas de qualquer mês e de áreas arquivadas. Pagas e canceladas ficam
 * fora. A fatura entra uma vez, pelo total considerado; as compras dela não aparecem em separado.
 */
export async function financasDashboard(user: AuthUser, today: CivilDate): Promise<DashboardModuleData> {
  const until = addDays(today, 7);
  const [entries, invoices, pending] = await Promise.all([
    withUserContext(user, async (db) => {
      const { rows } = await db.query<{ id: string; description: string; due: string; amount: string | null; number: number | null; count: number | null; method: PaymentMethod | null }>(
        `select e.id, e.description, to_char(e.due_date, 'YYYY-MM-DD') as due, e.amount_cents::text as amount,
                e.installment_number as number, p.installments_count::int as count, e.payment_method as method
           from public.fin_entries e left join public.fin_installment_plans p on p.id = e.installment_plan_id
          where e.status = 'pendente' and e.due_date <= $1::date
          order by e.due_date, e.id`,
        [until],
      );
      return rows;
    }),
    withUserContext(user, async (db) => (await queryInvoices(db, "2000-01-01", until)).filter((i) => i.status === "pendente")),
    // Recorrências precisam estar geradas até o horizonte (inclui hoje + 7); a geração é pedida pelo navegador.
    needsGeneration(user, generationWindow(until, today).target),
  ]);

  const place = (due: CivilDate) =>
    due < today ? ({ section: "atrasados", status: "atrasado" } as const) : due === today ? ({ section: "hoje", status: "hoje" } as const) : ({ section: "proximos", status: "proximo" } as const);

  const items: DashboardItem[] = [];
  for (const e of entries) {
    const known = e.amount !== null;
    const cents = known ? centsFromDb(e.amount!) : null;
    items.push({
      key: `financas:conta:${e.id}`,
      source: "financas",
      type: "conta",
      id: e.id,
      kind: "pendencia",
      ...place(e.due),
      title: e.description,
      detail: [e.method && PAYMENT_LABELS[e.method], e.number && e.count ? `Parcela ${e.number} de ${e.count}` : null].filter(Boolean).join(" · ") || null,
      date: e.due,
      amount: cents === null ? { kind: "unknown" } : { kind: "known", cents },
      href: `/financas/mes?mes=${e.due.slice(0, 7)}&conta=${e.id}`,
      actions: cents === null ? [] : [{ kind: "pagar_conta", entryId: e.id, description: e.description, amountCents: cents, dueDate: e.due }],
    });
  }
  for (const i of invoices) {
    items.push({
      key: `financas:fatura:${i.id}`,
      source: "financas",
      type: "fatura",
      id: i.id,
      kind: "pendencia",
      ...place(i.dueDate),
      title: i.cardName,
      detail: i.statedCents === null ? "Fatura do cartão · total não informado" : "Fatura do cartão",
      date: i.dueDate,
      amount: { kind: "known", cents: i.totalCents },
      href: `/financas/mes?mes=${i.dueDate.slice(0, 7)}&fatura=${i.id}`,
      actions: [{ kind: "pagar_fatura", invoiceId: i.id, cardName: i.cardName, dueDate: i.dueDate, statedCents: i.statedCents, detailedCents: i.detailedCents }],
    });
  }
  return { source: "financas", items, coverage: { generationTarget: pending ? generationWindow(until, today).target : null, note: null } };
}
