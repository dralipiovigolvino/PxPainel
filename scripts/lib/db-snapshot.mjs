// Backup lógico dos DADOS DO APP (schemas public e app_private) e sua conferência.
//
// - Fora do escopo: neon_auth (identidade/sessões, gerenciado pelo provedor) e schemas do sistema.
// - Os valores saem do banco como texto JSON (json_agg) e voltam por json_populate_recordset, sem
//   passar por números do JavaScript (bigint e numeric não perdem precisão).
// - Impressão digital da ESTRUTURA (colunas, restrições, índices, RLS, políticas, gatilhos, funções,
//   permissões) e dos DADOS (contagem + md5 das linhas ordenadas) para comparar origem e destino.
//   A impressão digital não contém valores das linhas, só nomes de objetos e hashes.

import { createHash } from "node:crypto";

export const APP_SCHEMAS = ["public", "app_private"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const ident = (name) => `"${name.replaceAll('"', '""')}"`;
export const qualified = (t) => `${ident(t.schema)}.${ident(t.table)}`;

/** Parâmetros de sessão fixos: a representação textual (datas, fuso, floats) é a mesma nos dois lados. */
export async function normalizeSession(client) {
  await client.query("set timezone = 'UTC'; set datestyle = 'ISO, YMD'; set extra_float_digits = 3; set bytea_output = 'hex'; set search_path = pg_catalog");
}

/** Tabelas do app em ordem de dependência (pais antes dos filhos). Recusa ciclos entre tabelas. */
export async function appTables(client) {
  const { rows: tables } = await client.query(
    `select n.nspname as schema, c.relname as "table", c.oid::int as oid
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname = any($1::text[])
      order by 1, 2`,
    [APP_SCHEMAS],
  );
  const { rows: fks } = await client.query(
    `select conrelid::int as child, confrelid::int as parent from pg_constraint
      where contype = 'f' and connamespace in (select oid from pg_namespace where nspname = any($1::text[]))`,
    [APP_SCHEMAS],
  );
  const byOid = new Map(tables.map((t) => [t.oid, t]));
  const parents = new Map(tables.map((t) => [t.oid, new Set()]));
  for (const fk of fks) if (fk.child !== fk.parent && byOid.has(fk.parent)) parents.get(fk.child)?.add(fk.parent);
  const ordered = [];
  const done = new Set();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t.oid) && [...parents.get(t.oid)].every((p) => done.has(p)));
    if (!ready.length) throw new Error("Ciclo de chaves estrangeiras entre tabelas: ordem de restauração indefinida.");
    for (const t of ready) {
      done.add(t.oid);
      ordered.push({ schema: t.schema, table: t.table });
    }
  }
  return ordered;
}

const STRUCTURE_QUERIES = {
  tabelas: `select n.nspname || '.' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.relkind in ('r', 'p', 'v', 'm') and n.nspname = any($1::text[])`,
  colunas: `select n.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                   || ' notnull=' || a.attnotnull || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
                   || ' gen=' || a.attgenerated::text || ' ident=' || a.attidentity::text
              from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
              left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where c.relkind in ('r', 'p') and n.nspname = any($1::text[]) and a.attnum > 0 and not a.attisdropped`,
  restricoes: `select n.nspname || '.' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid) || ' valid=' || k.convalidated
                 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = any($1::text[])`,
  indices: `select schemaname || ' ' || indexdef from pg_indexes where schemaname = any($1::text[])`,
  politicas: `select schemaname || '.' || tablename || ' ' || policyname || ' ' || permissive || ' ' || array_to_string(roles, ',')
                     || ' ' || cmd || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
                from pg_policies where schemaname = any($1::text[])`,
  gatilhos: `select n.nspname || ' ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
               from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where not t.tgisinternal and n.nspname = any($1::text[])`,
  funcoes: `select p.oid::regprocedure::text || ' secdef=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, ','), '-')
                   || ' md5=' || md5(pg_get_functiondef(p.oid))
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = any($1::text[]) and p.prokind in ('f', 'p')`,
  permissoes_tabelas: `select n.nspname || '.' || c.relname || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || x.privilege_type
                         from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) x
                        where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'S')
                          and x.grantee <> c.relowner`,
  permissoes_colunas: `select n.nspname || '.' || c.relname || '.' || a.attname || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || x.privilege_type
                         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(a.attacl) x
                        where n.nspname = any($1::text[]) and a.attnum > 0 and not a.attisdropped`,
  permissoes_schemas: `select n.nspname || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || x.privilege_type
                         from pg_namespace n, aclexplode(n.nspacl) x
                        where n.nspname = any($1::text[]) and x.grantee <> n.nspowner`,
  permissoes_funcoes: `select p.oid::regprocedure::text || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || x.privilege_type
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                        where n.nspname = any($1::text[]) and x.grantee <> p.proowner`,
  // Atributos do papel do app (o LOGIN fica de fora: é habilitado por branch no provisionamento).
  papel_app: `select rolname || ' super=' || rolsuper || ' inherit=' || rolinherit || ' createrole=' || rolcreaterole
                     || ' createdb=' || rolcreatedb || ' replication=' || rolreplication || ' bypassrls=' || rolbypassrls
                from pg_roles where rolname = 'app_runtime'`,
};

/** { categoria: { hash, lines } } — lines só com nomes e definições, sem dados. */
export async function structureFingerprint(client) {
  const out = {};
  for (const [name, sql] of Object.entries(STRUCTURE_QUERIES)) {
    const { rows } = await client.query(sql, sql.includes("$1") ? [APP_SCHEMAS] : []);
    const lines = rows.map((r) => Object.values(r)[0]).sort();
    out[name] = { hash: sha(lines.join("\n")), count: lines.length, lines };
  }
  return out;
}

/** Diferenças por categoria entre duas impressões digitais (ou manifesto com só os hashes). */
export function compareStructure(expected, actual) {
  const problems = [];
  for (const [name, exp] of Object.entries(expected)) {
    const act = actual[name];
    if (!act || act.hash !== exp.hash) {
      const missing = exp.lines && act ? exp.lines.filter((l) => !act.lines.includes(l)) : [];
      const extra = exp.lines && act ? act.lines.filter((l) => !exp.lines.includes(l)) : [];
      problems.push({ name, missing, extra });
    }
  }
  return problems;
}

/** Contagem e md5 do conteúdo (linhas como texto, ordenadas) de cada tabela. */
export async function dataDigests(client, tables) {
  const out = {};
  for (const t of tables) {
    const { rows } = await client.query(
      `select count(*)::int as n, md5(coalesce(string_agg(r::text, E'\\n' order by r::text), '')) as h from ${qualified(t)} r`,
    );
    out[`${t.schema}.${t.table}`] = { rows: rows[0].n, md5: rows[0].h };
  }
  return out;
}

/** Linhas da tabela como texto JSON (array). */
export async function exportTable(client, t) {
  const { rows } = await client.query(`select coalesce(json_agg(r), '[]'::json)::text as data from ${qualified(t)} r`);
  return rows[0].data;
}

/** Insere o JSON exportado. Gatilhos de usuário desligados só durante a carga; chaves estrangeiras continuam valendo. */
export async function importTable(client, t, json) {
  const { rows: cols } = await client.query(
    `select a.attname as name, a.attidentity as identity from pg_attribute a
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      order by a.attnum`,
    [qualified(t)],
  );
  const list = cols.map((c) => ident(c.name)).join(", ");
  const overriding = cols.some((c) => c.identity === "a") ? "overriding system value" : "";
  await client.query(`alter table ${qualified(t)} disable trigger user`);
  const result = await client.query(`insert into ${qualified(t)} (${list}) ${overriding} select ${list} from json_populate_recordset(null::${qualified(t)}, $1::json)`, [json]);
  await client.query(`alter table ${qualified(t)} enable trigger user`);
  return result.rowCount ?? 0;
}

/** Total de linhas nas tabelas do app (para recusar restaurar sobre um banco com dados). */
export async function appRowCount(client, tables) {
  let total = 0;
  for (const t of tables) total += (await client.query(`select count(*)::int as n from ${qualified(t)}`)).rows[0].n;
  return total;
}

export function fileHash(text) {
  return sha(text);
}
