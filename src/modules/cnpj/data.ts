import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { todayInSaoPaulo, type CivilDate } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { DEFAULT_TAX_RATE_BP } from "@/lib/tax";
import type { CnpjInput } from "./domain/schemas";
import type { Cnpj, CnpjOption } from "./types";

export type FailureReason = "not_found" | "duplicate_name" | "has_links" | "error";

/** Registros que passaram a usar o novo percentual quando ele mudou (trabalho de `from` em diante). */
export type RateApplied = { rateBp: number; from: CivilDate; shifts: number; exams: number; series: number };

export type MutationResult = { ok: true; id?: string; applied?: RateApplied } | { ok: false; reason: FailureReason };

type PgError = { code?: string; constraint?: string };

/** Traduz erros do banco em motivos; registra só o código. */
function toFailure(operation: string, error: unknown): MutationResult {
  const e = error as PgError;
  if (e?.code === "23505" && e.constraint === "cnpjs_user_name_key") return { ok: false, reason: "duplicate_name" };
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint?.endsWith("cnpj_fkey")) return { ok: false, reason: "has_links" };
  console.error(`[Meu Painel] cnpj/${operation} falhou (código ${e?.code ?? (error as Error)?.name ?? "?"})`);
  return { ok: false, reason: "error" };
}

async function run(operation: string, user: AuthUser, fn: (db: PoolClient) => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await withUserContext(user, fn);
  } catch (error) {
    return toFailure(operation, error);
  }
}

export async function listCnpjs(user: AuthUser): Promise<Cnpj[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; abbreviation: string; number: string | null; tax_rate_bp: number; tax_due_day: number; links: number }>(
      `select c.id, c.name, c.abbreviation, c.cnpj_number as number, c.tax_rate_bp, c.tax_due_day,
              (select count(*)::int from public.pl_types t where t.cnpj_id = c.id)
              + (select count(*)::int from public.pl_series r where r.cnpj_id = c.id)
              + (select count(*)::int from public.pl_shifts s where s.cnpj_id = c.id)
              + (select count(*)::int from public.per_companies k where k.cnpj_id = c.id)
              + (select count(*)::int from public.per_exams e where e.cnpj_id = c.id) as links
         from public.cnpjs c order by lower(c.name), c.id`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, abbreviation: r.abbreviation, number: r.number, taxRateBp: r.tax_rate_bp, taxDueDay: r.tax_due_day, links: r.links }));
  });
}

/** CNPJs para a marcação "recebo por CNPJ" (Plantões e Perícias) e para o imposto estimado em Finanças. */
export async function listCnpjOptions(user: AuthUser): Promise<CnpjOption[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; abbreviation: string; tax_rate_bp: number; tax_due_day: number }>("select id, name, abbreviation, tax_rate_bp, tax_due_day from public.cnpjs order by lower(name), id");
    return rows.map((r) => ({ id: r.id, name: r.name, abbreviation: r.abbreviation, taxRateBp: r.tax_rate_bp, taxDueDay: r.tax_due_day }));
  });
}

/**
 * Percentual do CNPJ agora, lido dentro de uma transação já aberta: é a alíquota que o plantão ou a
 * perícia grava ao ser marcado. null = CNPJ inexistente (ou de outra conta).
 */
export async function cnpjRateIn(db: PoolClient, cnpjId: string): Promise<number | null> {
  const { rows } = await db.query<{ tax_rate_bp: number }>("select tax_rate_bp from public.cnpjs where id = $1", [cnpjId]);
  return rows[0]?.tax_rate_bp ?? null;
}

/** Percentual sugerido para um CNPJ novo: o que o usuário já usava nas estimativas (9% se nunca mudou). */
export async function suggestedTaxRateBp(user: AuthUser): Promise<number> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{ tax_rate_bp: number }>("select tax_rate_bp from public.user_preferences where user_id = $1", [user.id]);
    return rows[0]?.tax_rate_bp ?? DEFAULT_TAX_RATE_BP;
  });
}

export function createCnpj(user: AuthUser, input: CnpjInput): Promise<MutationResult> {
  return run("create", user, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.cnpjs (user_id, name, abbreviation, cnpj_number, tax_rate_bp, tax_due_day) values ($1, $2, $3, $4, $5, $6) returning id",
      [user.id, input.name, input.abbreviation, input.number, input.taxRate, input.taxDueDay],
    );
    return { ok: true, id: rows[0].id };
  });
}

/**
 * O imposto do trabalho de um mês é pago no mês seguinte, então o percentual novo vale para o trabalho
 * do mês corrente em diante: plantões e perícias deste CNPJ a partir do dia 1º (qualquer situação,
 * recebidos ou não) e recorrências ainda ativas. Meses anteriores guardam a alíquota que tinham.
 * O histórico de cada registro é gravado antes, enquanto a alíquota anterior ainda está na linha.
 */
async function applyRate(db: PoolClient, cnpjId: string, rateBp: number, from: CivilDate): Promise<RateApplied> {
  const params = [cnpjId, rateBp, from];
  const SHIFTS = "s.cnpj_id = $1 and s.shift_date >= $3::date and s.tax_rate_bp <> $2";
  const EXAMS = "e.cnpj_id = $1 and e.exam_date >= $3::date and e.tax_rate_bp <> $2";
  await db.query(
    `insert into public.pl_events (user_id, shift_id, type_id, action, details)
     select s.user_id, s.id, s.type_id, 'aliquota_atualizada', jsonb_build_object('aliquota_bp', jsonb_build_object('de', s.tax_rate_bp, 'para', $2::integer))
       from public.pl_shifts s where ${SHIFTS}`,
    params,
  );
  const shifts = await db.query(`update public.pl_shifts s set tax_rate_bp = $2 where ${SHIFTS}`, params);
  await db.query(
    `insert into public.per_events (user_id, exam_id, company_id, action, details)
     select e.user_id, e.id, e.company_id, 'aliquota_atualizada', jsonb_build_object('aliquota_bp', jsonb_build_object('de', e.tax_rate_bp, 'para', $2::integer))
       from public.per_exams e where ${EXAMS}`,
    params,
  );
  const exams = await db.query(`update public.per_exams e set tax_rate_bp = $2 where ${EXAMS}`, params);
  const series = await db.query("update public.pl_series r set tax_rate_bp = $2 where r.cnpj_id = $1 and r.tax_rate_bp <> $2 and (r.end_date is null or r.end_date >= $3::date)", params);
  return { rateBp, from, shifts: shifts.rowCount ?? 0, exams: exams.rowCount ?? 0, series: series.rowCount ?? 0 };
}

export function updateCnpj(user: AuthUser, id: string, input: CnpjInput): Promise<MutationResult> {
  return run("update", user, async (db) => {
    const before = await db.query<{ tax_rate_bp: number }>("select tax_rate_bp from public.cnpjs where id = $1 for update", [id]);
    if (!before.rows[0]) return { ok: false, reason: "not_found" };
    await db.query("update public.cnpjs set name = $2, abbreviation = $3, cnpj_number = $4, tax_rate_bp = $5, tax_due_day = $6 where id = $1", [id, input.name, input.abbreviation, input.number, input.taxRate, input.taxDueDay]);
    if (before.rows[0].tax_rate_bp === input.taxRate) return { ok: true, id };
    return { ok: true, id, applied: await applyRate(db, id, input.taxRate, `${todayInSaoPaulo().slice(0, 7)}-01`) };
  });
}

/** Exclusão só sem uso: CNPJ marcado em tipo, recorrência, plantão, empresa ou perícia fica (RESTRICT no banco). */
export function deleteCnpj(user: AuthUser, id: string): Promise<MutationResult> {
  return run("delete", user, async (db) => {
    const r = await db.query("delete from public.cnpjs where id = $1", [id]);
    return r.rowCount ? { ok: true } : { ok: false, reason: "not_found" };
  });
}
