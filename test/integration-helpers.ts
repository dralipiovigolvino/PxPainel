import { Pool } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";

/** Contas fictícias de teste (ids reais do Neon Auth, vindos do .env.local). */
export function testUsers(): { A: AuthUser; B: AuthUser } {
  const a = process.env.RLS_TEST_A_ID;
  const b = process.env.RLS_TEST_B_ID;
  if (!a || !b || !process.env.APP_DATABASE_URL) {
    throw new Error("Defina APP_DATABASE_URL e RLS_TEST_A_ID/B_ID no .env.local (npm run auth:create-test-users).");
  }
  if (process.env.NEON_BRANCH !== "development") throw new Error("Testes de integração só rodam na branch development.");
  return { A: { id: a.toLowerCase(), email: null }, B: { id: b.toLowerCase(), email: null } };
}

export const TAG = `[teste-int ${Date.now()}]`;

/**
 * Consulta como o usuário, com o papel de EXECUÇÃO e o mesmo contexto do app (para conferências).
 */
export async function asUser<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const { rows } = await client.query(sql, params);
    await client.query("commit");
    return rows as T[];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Limpeza dos registros de teste pelas ÁREAS criadas na rodada (e tudo que depende delas).
 * Usa a conexão do dono só porque o app não tem DELETE em séries/exceções (por desenho).
 */
export async function cleanupAreas(areaIds: string[]): Promise<void> {
  if (areaIds.length === 0) return;
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED ausente para a limpeza.");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    // fin_events primeiro: é localizado pelos planos/compras que ainda existem.
    for (const table of ["fin_events", "fin_card_charges", "fin_card_purchases", "fin_entries", "fin_installment_plans", "fin_series_exceptions", "fin_series"]) {
      const exists = await client.query("select to_regclass($1) is not null as ok", [`public.${table}`]);
      if (!exists.rows[0].ok) continue;
      const hasArea = await client.query(
        "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'area_id') as ok",
        [table],
      );
      if (table === "fin_events") {
        const hasPurchases = (await client.query("select to_regclass('public.fin_card_purchases') is not null as ok")).rows[0].ok;
        await client.query(
          `delete from public.fin_events where entity_id in (
             select id from public.fin_installment_plans where area_id = any($1::uuid[])
             ${hasPurchases ? "union select id from public.fin_card_purchases where area_id = any($1::uuid[])" : ""})`,
          [areaIds],
        );
      } else if (table === "fin_series_exceptions") {
        await client.query("delete from public.fin_series_exceptions where series_id in (select id from public.fin_series where area_id = any($1::uuid[]))", [areaIds]);
      } else if (table === "fin_card_charges") {
        await client.query(
          "delete from public.fin_card_charges where purchase_id in (select id from public.fin_card_purchases where area_id = any($1::uuid[]))",
          [areaIds],
        );
      } else if (hasArea.rows[0].ok) {
        await client.query(`delete from public.${table} where area_id = any($1::uuid[])`, [areaIds]);
      }
    }
    await client.query("delete from public.fin_areas where id = any($1::uuid[])", [areaIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Limpeza do Follow-up pelos pacientes e modelos criados na rodada (conexão do dono, porque
 * o app não exclui modelos nem histórico por desenho). Tabelas da 0007 entram quando existirem.
 */
export async function cleanupFollowup(patientIds: string[], templateIds: string[]): Promise<void> {
  if (patientIds.length === 0 && templateIds.length === 0) return;
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED ausente para a limpeza.");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const exists = async (table: string) => (await client.query("select to_regclass($1) is not null as ok", [`public.${table}`])).rows[0].ok as boolean;
  try {
    await client.query("begin");
    if (await exists("fu_events")) await client.query("delete from public.fu_events where patient_id = any($1::uuid[])", [patientIds]);
    if (await exists("fu_steps")) {
      await client.query("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [patientIds]);
      await client.query("delete from public.fu_plans where patient_id = any($1::uuid[])", [patientIds]);
    }
    await client.query("delete from public.fu_consultations where patient_id = any($1::uuid[])", [patientIds]);
    await client.query("delete from public.fu_patients where id = any($1::uuid[])", [patientIds]);
    await client.query("delete from public.fu_template_steps where template_id = any($1::uuid[])", [templateIds]);
    await client.query("delete from public.fu_templates where id = any($1::uuid[])", [templateIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Limpeza de Plantões pelos tipos criados na rodada (histórico, ocorrências, séries e exceções, se existirem). */
export async function cleanupPlantoes(typeIds: string[]): Promise<void> {
  if (typeIds.length === 0) return;
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED ausente para a limpeza.");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const exists = async (t: string) => (await client.query("select to_regclass($1) is not null as ok", [`public.${t}`])).rows[0].ok as boolean;
  try {
    await client.query("begin");
    await client.query(
      "delete from public.pl_events where type_id = any($1::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($1::uuid[]))",
      [typeIds],
    );
    // Recebidos/realizados são protegidos por gatilho para o app; a manutenção do dono limpa por tipo.
    await client.query("delete from public.pl_shifts where type_id = any($1::uuid[])", [typeIds]);
    if (await exists("pl_series")) {
      await client.query("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [typeIds]);
      await client.query("delete from public.pl_series where type_id = any($1::uuid[])", [typeIds]);
    }
    await client.query("delete from public.pl_types where id = any($1::uuid[])", [typeIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Limpeza de Perícias pelas empresas criadas na rodada (histórico, perícias e empresas). */
export async function cleanupPericias(companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED ausente para a limpeza.");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from public.per_events where company_id = any($1::uuid[]) or exam_id in (select id from public.per_exams where company_id = any($1::uuid[]))", [companyIds]);
    await client.query("delete from public.per_exams where company_id = any($1::uuid[])", [companyIds]);
    await client.query("delete from public.per_companies where id = any($1::uuid[])", [companyIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Limpeza dos CNPJs criados na rodada, pelos ids (depois dos plantões e das perícias que os usam). */
export async function cleanupCnpjs(cnpjIds: string[]): Promise<void> {
  if (cnpjIds.length === 0) return;
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED ausente para a limpeza.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("delete from public.cnpjs where id = any($1::uuid[])", [cnpjIds]);
  } finally {
    await pool.end();
  }
}
