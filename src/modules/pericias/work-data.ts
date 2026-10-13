import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { WorkRecord } from "@/modules/cnpj/contract";

/**
 * Perícias como dinheiro, para o imposto estimado do CNPJ e as entradas da Visão geral de Finanças:
 * as do intervalo OU cujo valor entra nele (canceladas fora). Perícia não tem data prevista de
 * pagamento: sem recebimento registrado, o valor conta no dia da perícia.
 */
export async function listExamWork(user: AuthUser, from: CivilDate, to: CivilDate): Promise<WorkRecord[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; label: string; work_date: string; cash_date: string; received: boolean; amount: string; cnpj_id: string | null; tax_rate_bp: number }>(
      `select e.id, c.name as label, to_char(e.exam_date, 'YYYY-MM-DD') as work_date,
              to_char(coalesce(e.received_on, e.exam_date), 'YYYY-MM-DD') as cash_date,
              e.received_on is not null as received, e.amount_cents::text as amount, e.cnpj_id, e.tax_rate_bp
         from public.per_exams e join public.per_companies c on c.id = e.company_id
        where e.status <> 'cancelada'
          and (e.exam_date between $1::date and $2::date or coalesce(e.received_on, e.exam_date) between $1::date and $2::date)
        order by e.exam_date, e.exam_time, e.id`,
      [from, to],
    );
    return rows.map((r) => ({
      source: "pericia",
      id: r.id,
      label: r.label,
      workDate: r.work_date,
      cashDate: r.cash_date,
      received: r.received,
      amountCents: centsFromDb(r.amount),
      cnpjId: r.cnpj_id,
      taxRateBp: r.cnpj_id === null ? null : r.tax_rate_bp,
    }));
  });
}
