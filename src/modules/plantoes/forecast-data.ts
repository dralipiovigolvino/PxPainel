import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { todayInSaoPaulo, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import type { AmountKind } from "@/lib/tax";
import { logEvent, run, type MutationResult } from "./data";
import type { ForecastShift } from "./domain/payment";

/**
 * Plantões com previsão de pagamento e SEM recebimento registrado (cancelados fora), de qualquer mês.
 * A previsão não é recebimento: o plantão só sai daqui quando o recebimento é registrado.
 */
export async function listForecast(user: AuthUser): Promise<{ shifts: ForecastShift[]; withoutForecast: number }> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{
      id: string;
      type_name: string;
      date: string;
      status: "agendado" | "realizado";
      amount: string;
      amount_kind: AmountKind | null;
      tax_rate_bp: number | null;
      expected: string;
      manual: boolean;
    }>(
      `select s.id, t.name as type_name, to_char(s.shift_date, 'YYYY-MM-DD') as date, s.status, s.amount_cents::text as amount, s.amount_kind, s.tax_rate_bp,
              to_char(s.expected_pay_date, 'YYYY-MM-DD') as expected, s.expected_pay_manual as manual
         from public.pl_shifts s join public.pl_types t on t.id = s.type_id
        where s.status <> 'cancelado' and s.received_on is null and s.expected_pay_date is not null
        order by s.expected_pay_date, s.shift_date, s.id
        limit 2000`,
    );
    const none = await db.query<{ n: number }>("select count(*)::int as n from public.pl_shifts where status <> 'cancelado' and received_on is null and expected_pay_date is null");
    return {
      shifts: rows.map((r) => ({
        id: r.id,
        typeName: r.type_name,
        date: r.date,
        status: r.status,
        amountCents: centsFromDb(r.amount),
        amountKind: r.amount_kind,
        taxRateBp: r.tax_rate_bp,
        expectedPayDate: r.expected,
        expectedPayManual: r.manual,
      })),
      withoutForecast: none.rows[0].n,
    };
  });
}

/**
 * Impacto de aplicar a regra de pagamento ATUAL do tipo aos plantões já criados:
 * - sem regra (nunca tiveram previsão): qualquer data, não cancelados e sem recebimento — só preenche o que falta;
 * - com regra diferente: só agendados de hoje em diante.
 * Preservados: recebidos, com previsão ajustada manualmente, e (na troca de regra) realizados e passados.
 */
export type TypeRuleImpact = { payDay: number | null; payMonthOffset: 0 | 1; fill: number; change: number; preserved: number; series: number };

const FILL = "s.pay_day is null and s.status <> 'cancelado' and s.received_on is null and not s.expected_pay_manual";
const CHANGE = "s.pay_day is not null and s.status = 'agendado' and s.received_on is null and not s.expected_pay_manual and s.shift_date >= $2::date";

async function impactOf(db: PoolClient, typeId: string, today: CivilDate): Promise<TypeRuleImpact | null> {
  const type = await db.query<{ pay_day: number | null; pay_month_offset: 0 | 1 }>("select pay_day, pay_month_offset from public.pl_types where id = $1 for share", [typeId]);
  if (!type.rows[0]) return null;
  const payDay = type.rows[0].pay_day;
  const payMonthOffset = type.rows[0].pay_month_offset;
  const { rows } = await db.query<{ fill: number; change: number; preserved: number }>(
    `select count(*) filter (where $3::smallint is not null and ${FILL})::int as fill,
            count(*) filter (where ${CHANGE} and (s.pay_day is distinct from $3::smallint or s.pay_month_offset is distinct from $4::smallint))::int as change,
            count(*) filter (where s.status <> 'cancelado' and (s.pay_day is distinct from $3::smallint or s.pay_month_offset is distinct from $4::smallint)
                                   and not (($3::smallint is not null and ${FILL}) or (${CHANGE})))::int as preserved
       from public.pl_shifts s where s.type_id = $1`,
    [typeId, today, payDay, payMonthOffset],
  );
  const series = await db.query<{ n: number }>(
    "select count(*)::int as n from public.pl_series where type_id = $1 and (pay_day is distinct from $3::smallint or pay_month_offset is distinct from $4::smallint) and (end_date is null or end_date >= $2::date)",
    [typeId, today, payDay, payMonthOffset],
  );
  return { payDay, payMonthOffset, ...rows[0], series: series.rows[0].n };
}

/** Prévia (somente leitura). */
export async function typeRuleImpact(user: AuthUser, typeId: string): Promise<TypeRuleImpact | null> {
  return withUserContext(user, (db) => impactOf(db, typeId, todayInSaoPaulo()));
}

/** Aplica a regra atual do tipo (ação explícita, depois da prévia). A data prevista é recalculada pelo banco. */
export function applyTypeRule(user: AuthUser, typeId: string): Promise<MutationResult> {
  return run("type.apply_rule", user, async (db) => {
    const today = todayInSaoPaulo();
    const impact = await impactOf(db, typeId, today);
    if (!impact) return { ok: false, reason: "not_found" };
    if (impact.fill + impact.change + impact.series === 0) return { ok: false, reason: "nothing_to_do" };
    const updated = await db.query(
      `update public.pl_shifts s set pay_day = $3::smallint, pay_month_offset = $4::smallint
        where s.type_id = $1 and (s.pay_day is distinct from $3::smallint or s.pay_month_offset is distinct from $4::smallint)
          and (($3::smallint is not null and ${FILL}) or (${CHANGE}))`,
      [typeId, today, impact.payDay, impact.payMonthOffset],
    );
    await db.query("update public.pl_series set pay_day = $3::smallint, pay_month_offset = $4::smallint where type_id = $1 and (pay_day is distinct from $3::smallint or pay_month_offset is distinct from $4::smallint) and (end_date is null or end_date >= $2::date)", [typeId, today, impact.payDay, impact.payMonthOffset]);
    await logEvent(db, user.id, { typeId, action: "regra_pagamento_aplicada", details: { dia: impact.payDay, plantoes: updated.rowCount ?? 0, recorrencias: impact.series, preservados: impact.preserved } });
    return { ok: true, id: typeId, count: updated.rowCount ?? 0 };
  });
}
