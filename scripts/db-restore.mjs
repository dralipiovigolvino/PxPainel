// Restaura um backup de db-backup.mjs num banco de DESTINO VAZIO e confere o resultado.
//
// Segurança:
// - Destino só por RESTORE_DATABASE_URL (conexão do dono da branch de destino), nunca a branch ligada.
// - Exige --confirm-endpoint <id do endpoint de destino> (ex.: ep-xxxx), conferido com a URL.
// - Recusa se o destino tiver qualquer linha nas tabelas do app, ou migrações diferentes do backup.
// - Recusa as migrações do repositório que não batem (versão/checksum) com as do backup.
//
// Passos: aplica as migrações do repositório (se o destino estiver sem elas) → carrega os dados numa
// única transação (gatilhos de usuário desligados só durante a carga; chaves estrangeiras valendo) →
// confere contagens, md5 do conteúdo, estrutura e validade das chaves estrangeiras.
//
// Uso: RESTORE_DATABASE_URL=... npm run db:restore -- --from <pasta> --confirm-endpoint <ep-...>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { describeDbUrl } from "./lib/branch-guard.mjs";
import { appRowCount, appTables, compareStructure, dataDigests, fileHash, importTable, normalizeSession, structureFingerprint } from "./lib/db-snapshot.mjs";
import { applyMigrations, readMigrations } from "./lib/migrations.mjs";

const endpointOf = (url) => new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");

/** Restaura e confere. Devolve { checks: [{ name, ok, detail }] }. */
export async function runRestore(targetUrl, fromDir, { log = console.log } = {}) {
  for (const linked of [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED, process.env.APP_DATABASE_URL]) {
    if (linked && endpointOf(linked) === endpointOf(targetUrl)) throw new Error("O destino é a branch ligada a esta pasta. Restaure só em uma branch descartável.");
  }
  const manifest = JSON.parse(readFileSync(join(fromDir, "manifest.json"), "utf8"));
  if (manifest.format !== 1) throw new Error("Formato de backup desconhecido.");
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
    log(`${ok ? "OK  " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // Integridade dos arquivos antes de tocar no destino.
  const data = new Map();
  for (const t of manifest.tables) {
    const json = readFileSync(join(fromDir, t.file), "utf8");
    if (fileHash(json) !== t.sha256) throw new Error(`Arquivo ${t.file} alterado ou corrompido (sha256 diferente).`);
    data.set(`${t.schema}.${t.table}`, json);
  }
  check("arquivos do backup íntegros (sha256)", true, `${manifest.tables.length} arquivo(s)`);

  // Código (migrações do repositório) compatível com o backup.
  const repo = readMigrations();
  const last = manifest.migrations.at(-1)?.version;
  const repoUpTo = repo.filter((m) => m.version <= last).map((m) => `${m.version}:${m.checksum}`);
  const backupMigs = manifest.migrations.map((m) => `${m.version}:${m.checksum}`);
  if (repoUpTo.join() !== backupMigs.join()) throw new Error("As migrações do repositório não batem com as do backup (versão ou checksum).");

  const client = new Client(targetUrl);
  await client.connect();
  try {
    log(`Destino: ${describeDbUrl(targetUrl)}`);
    // 1) Estrutura pelas migrações (só se o destino estiver sem migrações).
    const hasTable = (await client.query("select to_regclass('app_private.schema_migrations') is not null as ok")).rows[0].ok;
    const existing = hasTable ? (await client.query("select version, checksum from app_private.schema_migrations order by version")).rows : [];
    if (!existing.length) {
      const res = await applyMigrations(client, { until: last, log: () => {} });
      if (res.failed) throw new Error(`Migração falhou no destino: ${res.failed}`);
      check("migrações aplicadas no destino vazio", true, `${res.applied.length} (${res.applied[0]} … ${res.applied.at(-1)})`);
    } else if (existing.map((m) => `${m.version}:${m.checksum}`).join() !== backupMigs.join()) {
      throw new Error("O destino já tem migrações diferentes das do backup.");
    }
    const applied = (await client.query("select version, checksum from app_private.schema_migrations order by version")).rows;
    check("migrações do destino = do backup (versão e checksum)", applied.map((m) => `${m.version}:${m.checksum}`).join() === backupMigs.join(), `${applied.length} versão(ões)`);

    await normalizeSession(client);
    const tables = await appTables(client);
    const names = tables.map((t) => `${t.schema}.${t.table}`);
    const expectedNames = manifest.tables.map((t) => `${t.schema}.${t.table}`);
    check("mesmas tabelas do backup", names.slice().sort().join() === expectedNames.slice().sort().join(), `${names.length} tabela(s)`);
    const dataTables = tables.filter((t) => !(t.schema === "app_private" && t.table === "schema_migrations"));
    const before = await appRowCount(client, dataTables);
    if (before) throw new Error(`O destino já tem ${before} linha(s) de dados do app. Use um banco vazio.`);

    // 2) Dados: uma transação; ordem pais → filhos; chaves estrangeiras conferidas na inserção.
    await client.query("begin");
    try {
      let total = 0;
      for (const t of dataTables) total += await importTable(client, t, data.get(`${t.schema}.${t.table}`));
      await client.query("commit");
      check("dados carregados numa única transação", true, `${total} linha(s)`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
    await client.query("analyze");

    // 3) Conferência.
    const digests = await dataDigests(client, dataTables);
    const mismatched = manifest.tables
      .filter((t) => !(t.schema === "app_private" && t.table === "schema_migrations"))
      .filter((t) => digests[`${t.schema}.${t.table}`]?.rows !== t.rows || digests[`${t.schema}.${t.table}`]?.md5 !== t.md5)
      .map((t) => t.table);
    check("contagem e conteúdo (md5) idênticos em todas as tabelas", !mismatched.length, mismatched.length ? mismatched.join(", ") : `${dataTables.length} tabela(s)`);
    const structure = await structureFingerprint(client);
    const diff = compareStructure(manifest.structure, structure);
    check(
      "estrutura idêntica (colunas, restrições, índices, RLS, políticas, gatilhos, funções, permissões)",
      !diff.length,
      diff.length
        ? diff.map((d) => `${d.name}: -${d.missing.length} +${d.extra.length}`).join("; ")
        : Object.entries(structure).map(([k, v]) => `${k} ${v.count}`).join(", "),
    );
    for (const d of diff) for (const l of [...d.missing.map((x) => `  falta: ${x}`), ...d.extra.map((x) => `  sobra: ${x}`)].slice(0, 20)) log(l);
    const invalid = (await client.query("select count(*)::int as n from pg_constraint where contype = 'f' and not convalidated and connamespace in ('public'::regnamespace, 'app_private'::regnamespace)")).rows[0].n;
    check("chaves estrangeiras válidas", invalid === 0);
    const disabled = (await client.query("select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgenabled = 'D' and c.relnamespace in ('public'::regnamespace, 'app_private'::regnamespace)")).rows[0].n;
    check("gatilhos religados", disabled === 0);
    return { checks, manifest };
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const target = process.env.RESTORE_DATABASE_URL;
  const from = arg("--from");
  const confirm = arg("--confirm-endpoint");
  if (!target || !from || !confirm) {
    console.error("Uso: RESTORE_DATABASE_URL=<dono da branch DESCARTÁVEL> npm run db:restore -- --from <pasta> --confirm-endpoint <ep-...>");
    process.exit(2);
  }
  if (endpointOf(target) !== confirm) {
    console.error("--confirm-endpoint não corresponde ao endpoint de RESTORE_DATABASE_URL.");
    process.exit(2);
  }
  try {
    const { checks } = await runRestore(target, from);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(failed ? `Restauração com ${failed} falha(s).` : "Restauração conferida.");
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`Restauração recusada/falhou: ${error.code ?? ""} ${error.message}`);
    process.exitCode = 1;
  }
}
