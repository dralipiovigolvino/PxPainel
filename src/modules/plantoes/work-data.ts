import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import type { CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { WorkRecord } from "@/modules/cnpj/contract";

/**
 * Plantões como dinheiro, para o imposto estimado do CNPJ e as entradas da Visão geral de Finanças:
 * os trabalhados no intervalo OU cujo valor entra nele (cancelados fora). O dia em que o valor entra é
 * o do recebimento registrado; sem ele, a data prevista de pagamento; sem ela, o dia do plantão.
 */
export async function listShiftWork(user: AuthUser, from: CivilDate, to: CivilDate): Promise<WorkRecord[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; label: string; work_date: string; cash_date: string; received: boolean; amount: string; cnpj_id: string | null; tax_rate_bp: number | null }>(
      `select s.id, t.name as label, to_char(s.shift_date, 'YYYY-MM-DD') as work_date,
              to_char(coalesce(s.received_on, s.expected_pay_date, s.shift_date), 'YYYY-MM-DD') as cash_date,
              s.received_on is not null as received, s.amount_cents::text as amount, s.cnpj_id, s.tax_rate_bp
         from public.pl_shifts s join public.pl_types t on t.id = s.type_id
        where s.status <> 'cancelado'
          and (s.shift_date between $1::date and $2::date
               or coalesce(s.received_on, s.expected_pay_date, s.shift_date) between $1::date and $2::date)
        order by s.shift_date, s.id`,
      [from, to],
    );
    return rows.map((r) => ({
      source: "plantao",
      id: r.id,
      label: r.label,
      workDate: r.work_date,
      cashDate: r.cash_date,
      received: r.received,
      amountCents: centsFromDb(r.amount),
      cnpjId: r.cnpj_id,
      taxRateBp: r.tax_rate_bp,
    }));
  });
}
