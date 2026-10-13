// Teste ponta a ponta de Finanças na APLICAÇÃO, com Neon Auth e Neon reais (branch development).
// Usa SOMENTE a conta fictícia A (e B para o isolamento). Dados de teste têm o prefixo "[teste-e2e]"
// e são removidos ao final (só os desta conta e deste prefixo).
//
// Cobre: áreas (lista única, sem seção de arquivadas), formas de pagamento (cartões primeiro, Pix e
// boleto, arquivados no fim), aba Mês (contas separadas por área e compras agrupadas debaixo da linha
// do cartão), pagar e voltar, situação e área, edição e exclusão, recorrência e parcelamento com forma
// de pagamento, cartão (total real da fatura, pagamento na linha do cartão, desfazer, fatura sem
// compras), Visão geral com gráficos e filtros, Recorrências (botão Nova recorrência), endereços
// antigos e isolamento.
//
// Pré-requisitos: app rodando em APP_URL (npm run build && npm run start) e RLS_TEST_* no .env.local.
// Uso: npm run test:e2e:financas

import { Client } from "@neondatabase/serverless";
import { assertBranch } from "./lib/branch-guard.mjs";
import { createChecks, startBrowser } from "./lib/browser.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["DATABASE_URL_UNPOOLED", "RLS_TEST_A_EMAIL", "RLS_TEST_A_PASSWORD", "RLS_TEST_A_ID", "RLS_TEST_B_EMAIL", "RLS_TEST_B_PASSWORD"]);
assertBranch("test:e2e:financas");
const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD, id: process.env.RLS_TEST_A_ID };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const P = "[teste-e2e]";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (civil, days) => {
  const [y, m, d] = civil.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const addMonths = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const br = (civil) => civil.split("-").reverse().join("/");
const thisMonth = today.slice(0, 7);
// Cartão de teste: fecha dia 28, vence dia 5 (vencimento no mês seguinte ao fechamento).
const firstDueMonth = Number(today.slice(8, 10)) < 28 ? addMonths(thisMonth, 1) : addMonths(thisMonth, 2);
const firstDue = `${firstDueMonth}-05`;

/** Compras e faturas que a interface remove: o histórico delas (fin_events) só é alcançável pelo ID, guardado antes da remoção. */
const removedPurchases = [];
const removedInvoices = [];
async function remember(list, sql, params) {
  const c = new Client(process.env.DATABASE_URL_UNPOOLED);
  await c.connect();
  try {
    list.push(...(await c.query(sql, params)).rows.map((r) => r.id));
  } finally {
    await c.end();
  }
}
const rememberPurchases = (description) => remember(removedPurchases, "select id from public.fin_card_purchases where user_id = $1 and description = $2", [A.id, description]);
const rememberInvoices = (cardName) =>
  remember(removedInvoices, "select i.id from public.fin_invoices i join public.fin_cards c on c.id = i.card_id where i.user_id = $1 and c.name = $2", [A.id, cardName]);

/** Remove só os registros de teste da conta A (pelo prefixo), com o dono da branch (séries não têm DELETE no app). */
async function cleanup() {
  const c = new Client(process.env.DATABASE_URL_UNPOOLED);
  await c.connect();
  let n = 0;
  try {
    await c.query("begin");
    const ids = async (table, column) => (await c.query(`select id from public.${table} where user_id = $1 and ${column} like $2`, [A.id, `${P}%`])).rows.map((r) => r.id);
    const areas = await ids("fin_areas", "name");
    const cards = await ids("fin_cards", "name");
    const q = async (sql, params) => (n += (await c.query(sql, params)).rowCount ?? 0);
    await q("delete from public.fin_events where entity_id in (select id from public.fin_card_purchases where card_id = any($1::uuid[]) or area_id = any($2::uuid[])) or entity_id in (select id from public.fin_installment_plans where area_id = any($2::uuid[])) or entity_id in (select id from public.fin_invoices where card_id = any($1::uuid[]))", [cards, areas]);
    await q("delete from public.fin_events where user_id = $1 and entity_type = 'compra' and entity_id = any($2::uuid[])", [A.id, removedPurchases]);
    await q("delete from public.fin_events where user_id = $1 and entity_type = 'fatura' and entity_id = any($2::uuid[])", [A.id, removedInvoices]);
    await c.query("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[]) and status <> 'pendente'", [cards]);
    await q("delete from public.fin_card_charges where card_id = any($1::uuid[]) or purchase_id in (select id from public.fin_card_purchases where area_id = any($2::uuid[]))", [cards, areas]);
    await q("delete from public.fin_card_purchases where card_id = any($1::uuid[]) or area_id = any($2::uuid[])", [cards, areas]);
    await q("delete from public.fin_invoices where card_id = any($1::uuid[]) and not exists (select 1 from public.fin_card_charges ch where ch.invoice_id = fin_invoices.id)", [cards]);
    await q("delete from public.fin_cards where id = any($1::uuid[])", [cards]);
    await q("delete from public.fin_entries where area_id = any($1::uuid[])", [areas]);
    await q("delete from public.fin_installment_plans where area_id = any($1::uuid[])", [areas]);
    await q("delete from public.fin_series_exceptions where series_id in (select id from public.fin_series where area_id = any($1::uuid[]))", [areas]);
    await q("delete from public.fin_series where area_id = any($1::uuid[])", [areas]);
    await q("delete from public.fin_areas where id = any($1::uuid[])", [areas]);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => {});
    throw error;
  } finally {
    await c.end();
  }
  return n;
}

const t = createChecks();
const b = await startBrowser({ port: 9337 });
const { ev, check } = { ev: b.ev, check: t.check };
const norm = (s) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const notice = () => ev(`document.querySelector('[data-notice] p')?.textContent ?? ''`);
// Sucesso = diálogo fechado E aviso que começa com o texto (alguns avisos trazem a data de vencimento).
const waitNotice = (text) =>
  b.waitFor(`!document.querySelector('[role=dialog], [role=alertdialog]') && (document.querySelector('[data-notice] p')?.textContent ?? '').startsWith(${JSON.stringify(text)})`, 25000);
const submit = () => ev(`[...document.querySelectorAll('[role=dialog] form button[type=submit]')].at(-1).click()`);
const fieldError = (id) => ev(`document.getElementById(${JSON.stringify(id + "-erro")})?.textContent ?? null`);
/** Marca o rádio (botão de escolha) do diálogo cujo rótulo começa com o texto. */
const choose = (name, label) =>
  ev(`(() => { const i = [...document.querySelectorAll('[role=dialog] input[type=radio][name=${name}]')].find(i => i.closest('label').textContent.trim().startsWith(${JSON.stringify(label)})); if (!i) return false; i.click(); return true; })()`);
const chosen = (name) => ev(`(() => { const i = document.querySelector('[role=dialog] input[type=radio][name=${name}]:checked'); return i ? i.closest('label').textContent.trim() : null; })()`);
const chipsOf = (name) => ev(`[...document.querySelectorAll('[role=dialog] input[type=radio][name=${name}]')].map(i => i.closest('label').textContent.trim())`);
const totals = () => ev(`Object.fromEntries([...document.querySelectorAll('[aria-label="Resumo do mês"] [data-total]')].map(d => [d.dataset.total, d.querySelector('dd').textContent.replace(/\\u00a0/g, ' ')]))`);
/** Resumo da Visão geral. Sem plantões nem perícias lançados, só as saídas: total, pago e a pagar. */
const flow = () => ev(`Object.fromEntries([...document.querySelectorAll('[data-summary] [data-stat]')].map(d => [d.dataset.stat, d.textContent.replace(/\\u00a0/g, ' ').trim()]))`);
const stats = async () => {
  const s = await flow();
  return { total: s.saidas, pago: s.pago, "a-pagar": s["a-pagar"] };
};
const row = async (desc) => norm(await ev(`(() => { const r = [...document.querySelectorAll('[data-entry-id], [data-charge-id]')].find(li => li.textContent.includes(${JSON.stringify(desc)})); return r ? r.innerText : null; })()`)) || null;
/** Bloco de um cartão na aba Mês (linha do cartão + compras): expressão do elemento, texto e partes. */
const cardGroup = (card) => `[...document.querySelectorAll('[data-card-group]')].find(s => s.querySelector('button[aria-label^="Abrir fatura"]')?.textContent.includes(${JSON.stringify(card)}))`;
const cardText = async (card) => norm(await ev(`${cardGroup(card)}?.innerText ?? ''`));
const cardPart = async (card, selector) => norm(await ev(`${cardGroup(card)}?.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`));
const cardAttr = (card, attr) => ev(`${cardGroup(card)}?.getAttribute(${JSON.stringify(attr)}) ?? null`);
const clickInCard = (card, selector) => ev(`(() => { const el = ${cardGroup(card)}?.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const rowAttr = (desc, attr) => ev(`[...document.querySelectorAll('[data-entry-id], [data-charge-id]')].find(li => li.textContent.includes(${JSON.stringify(desc)}))?.getAttribute(${JSON.stringify(attr)}) ?? null`);
const bars = (chart) => ev(`[...document.querySelectorAll('[data-chart=${chart}] [data-bar]')].map(li => li.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim())`);
const chip = async (nav, key) => {
  await ev(`document.querySelector('nav[aria-label=${JSON.stringify(nav)}] [data-chip=${JSON.stringify(key)}]').click()`);
  await b.waitFor(`document.querySelector('nav[aria-label=${JSON.stringify(nav)}] [data-chip=${JSON.stringify(key)}]')?.getAttribute('aria-current') === 'true'`, 20000);
  await b.settle(600);
};
const body = () => ev(`document.querySelector('main').innerText`);
const press = async (key) => {
  for (const type of ["keyDown", "keyUp"]) await b.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Escape" ? 27 : 13 });
};

let ids = {};
try {
  t.info(`limpeza prévia: ${await cleanup()} registro(s) de teste antigos removidos`);
  t.info(`hoje ${br(today)}; compra no cartão de teste vence primeiro em ${br(firstDue)}`);
  await b.viewport(1280, 900);
  await b.login(A);

  // ---------------- Navegação ----------------
  await b.goto("/financas");
  const tabs = await ev(`[...document.querySelectorAll('nav[aria-label="Seções de Finanças"] a')].map(a => a.textContent.trim())`);
  check("abas: Visão geral primeiro, depois Mês, Recorrências, Formas de pagamento e Áreas", JSON.stringify(tabs) === JSON.stringify(["Visão geral", "Mês", "Recorrências", "Formas de pagamento", "Áreas"]), tabs);
  check("Visão geral é a aba ativa em /financas", (await ev(`document.querySelector('nav[aria-label="Seções de Finanças"] a[aria-current=page]')?.textContent`)) === "Visão geral");
  for (const [from, to] of [["/financas/visao", "/financas"], ["/financas/cartoes", "/financas/formas-de-pagamento"], ["/financas/parcelamentos", "/financas/recorrencias"]]) {
    await b.goto(from);
    check(`endereço antigo ${from} leva a ${to}`, (await ev("location.pathname")) === to, await ev("location.pathname"));
  }

  // ---------------- Áreas ----------------
  await b.goto("/financas/areas");
  check("Áreas: sem seção de arquivadas nem textos de ajuda", !/Áreas arquivadas|Áreas ativas|Excluir só é possível/.test(await body()));
  for (const [name, color] of [[`${P} Casa`, "Verde"], [`${P} Clínica`, "Roxo"], [`${P} Temporária`, "Cinza"]]) {
    await b.click("Nova área");
    await b.waitFor(`document.querySelector('#area-name')`);
    await b.type("#area-name", name);
    await b.click(color, "[role=dialog]");
    await submit();
    check(`criar área ${name}`, await waitNotice("Área criada."), await notice());
  }
  await b.click("Nova área");
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.type("#area-name", `  ${P.toUpperCase()} casa  `);
  await submit();
  await b.waitFor(`document.getElementById('area-name-erro')`);
  check("nome duplicado recusado junto ao campo, com o valor preservado e o foco no campo", (await fieldError("area-name")) === "Já existe uma área com esse nome." && (await ev(`document.querySelector('#area-name').value`)).includes("casa") && (await ev("document.activeElement?.id")) === "area-name");
  await press("Escape");
  ids = Object.fromEntries(await ev(`[...document.querySelectorAll('[data-area]')].map(li => [li.innerText.trim().split('\\n')[0], li.dataset.area])`));
  // Excluir área sem vínculos (no diálogo da área).
  await b.click(`Editar ${P} Temporária`);
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.click("Excluir", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Excluir", "[role=alertdialog]");
  check("excluir área sem contas, pelo diálogo da área", await waitNotice("Área excluída."), await notice());
  // Arquivar: continua na mesma lista, no fim e apagada.
  await b.click(`Editar ${P} Clínica`);
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.click("Arquivar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Arquivar", "[role=alertdialog]");
  check("arquivar área", await waitNotice("Área arquivada."), await notice());
  const areaRows = await ev(`[...document.querySelectorAll('[data-area]')].map(li => ({ name: li.innerText.trim().split('\\n')[0], archived: li.hasAttribute('data-archived') }))`);
  const clinicaIdx = areaRows.findIndex((r) => r.name === `${P} Clínica`);
  check("área arquivada fica no fim da mesma lista, marcada", clinicaIdx === areaRows.length - 1 && areaRows[clinicaIdx].archived, areaRows);
  await b.click(`Editar ${P} Clínica`);
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.click("Restaurar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Restaurar", "[role=alertdialog]");
  check("restaurar área", await waitNotice("Área restaurada."), await notice());

  // ---------------- Formas de pagamento ----------------
  await b.goto("/financas/formas-de-pagamento");
  check("sem informação de faturas pagas/abertas nem seção de arquivados", !/Faturas|fatura|Cartões arquivados/.test(await body()));
  check("Pix e boleto aparecem como formas de pagamento", await ev(`!!document.querySelector('[data-method=pix]') && !!document.querySelector('[data-method=boleto]')`));
  await b.click("Cadastrar cartão");
  await b.waitFor(`document.querySelector('#card-name')`);
  await b.type("#card-name", `${P} Visa`);
  await b.type("#card-closing", "32");
  await b.type("#card-due", "5");
  await submit();
  await b.waitFor(`document.getElementById('card-closing-erro')`);
  check("dia inválido (32) recusado junto ao campo", (await fieldError("card-closing")) === "Use um dia de 1 a 31.", await fieldError("card-closing"));
  await b.type("#card-closing", "28");
  await b.setValue("#card-default-area", ids[`${P} Casa`]);
  await submit();
  check("cadastrar cartão com área padrão", await waitNotice("Cartão criado."), await notice());
  await b.click("Cadastrar cartão");
  await b.waitFor(`document.querySelector('#card-name')`);
  await b.type("#card-name", `${P} Master`);
  await b.type("#card-closing", "10");
  await b.type("#card-due", "20");
  await submit();
  check("cadastrar segundo cartão (sem área padrão)", await waitNotice("Cartão criado."), await notice());
  const order = () => ev(`[...document.querySelectorAll('section[aria-label="Formas de pagamento"] li')].map(li => li.dataset.method ?? (li.hasAttribute('data-archived') ? 'arquivado:' : '') + li.innerText.trim().split('\\n')[0])`);
  let methods = await order();
  check("cartões ativos aparecem em cima, depois Pix e boleto", methods.indexOf(`${P} Visa`) < methods.indexOf("pix") && methods.indexOf(`${P} Master`) < methods.indexOf("pix"), methods);
  await b.click(`Editar ${P} Master`);
  await b.waitFor(`document.querySelector('#card-name')`);
  await b.click("Arquivar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Arquivar", "[role=alertdialog]");
  check("arquivar cartão", await waitNotice("Cartão arquivado."), await notice());
  methods = await order();
  check("cartão arquivado vai para o fim da lista, marcado (sem seção própria)", methods.at(-1)?.startsWith("arquivado:") && methods.indexOf("boleto") < methods.length - 1, methods);
  await b.click(`Editar ${P} Master`);
  await b.waitFor(`document.querySelector('#card-name')`);
  await b.click("Restaurar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Restaurar", "[role=alertdialog]");
  check("restaurar cartão", await waitNotice("Cartão restaurado."), await notice());

  // ---------------- Mês: contas com forma de pagamento ----------------
  await b.goto(`/financas/mes?mes=${thisMonth}`);
  check("aba Mês sem botões repetidos das abas (Cartões, Nova área, Gerenciar áreas)", !(await ev(`[...document.querySelectorAll('main a, main button')].some(e => ['Cartões', 'Nova área', 'Gerenciar áreas'].includes(e.textContent.trim()))`)));
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  const methodChips = await chipsOf("method");
  check("Nova conta começa pela forma de pagamento: Pix, Boleto e os cartões ativos", JSON.stringify(methodChips.slice(0, 2)) === JSON.stringify(["Pix", "Boleto"]) && methodChips.includes(`${P} Visa`) && methodChips.includes(`${P} Master`), methodChips);
  await choose("method", "Pix");
  await b.waitFor(`document.querySelector('#entry-amount')`);
  check("Uma vez vem marcado", (await chosen("kind")) === "Uma vez");
  await b.type("#entry-amount", "12.5");
  await b.setValue("#entry-due", today);
  await b.type("#entry-description", `${P} Aluguel`);
  await choose("areaId", `${P} Casa`);
  await submit();
  await b.waitFor(`document.getElementById('entry-amount-erro')`);
  check("valor inválido recusado junto ao campo", (await fieldError("entry-amount")) === "Valor inválido. Use o formato 1.234,56.", await fieldError("entry-amount"));
  check("após o erro, forma, área e descrição continuam como estavam", (await chosen("method")) === "Pix" && (await chosen("areaId")) === `${P} Casa` && (await ev(`document.querySelector('#entry-description').value`)) === `${P} Aluguel`);
  await b.type("#entry-amount", "1.500,00");
  await submit();
  check("criar conta Pix: o aviso diz o vencimento", await waitNotice(`Conta criada. Vence em ${br(today)}`), await notice());
  check("conta aparece no mês, na área Casa, com Pix", (await row(`${P} Aluguel`))?.includes("Pix") && (await ev(`[...document.querySelectorAll('[data-area-group]')].find(g => g.textContent.includes(${JSON.stringify(`${P} Aluguel`)}))?.querySelector('h3')?.textContent`))?.includes(`${P} Casa`), await row(`${P} Aluguel`));

  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await choose("method", "Boleto");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=kind]')`);
  await choose("kind", "Recorrente");
  await b.waitFor(`document.querySelector('#series-amount')`);
  await b.type("#series-amount", "100,00");
  await b.type("#series-description", `${P} Internet`);
  await b.setValue("#series-start", today);
  await choose("areaId", `${P} Clínica`);
  await submit();
  check("criar recorrência no boleto", await waitNotice("Recorrência criada."), await notice());
  check("ocorrência do mês aparece com Boleto e Recorrente", /Boleto/.test(await row(`${P} Internet`)) && /Recorrente/.test(await row(`${P} Internet`)), await row(`${P} Internet`));

  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await choose("method", "Pix");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=kind]')`);
  await choose("kind", "Parcelada");
  await b.waitFor(`document.querySelector('#plan-total')`);
  await b.type("#plan-total", "300,00");
  await b.type("#plan-count", "3");
  await b.setValue("#plan-first-due", today);
  await b.waitFor(`document.querySelector('[data-split-preview]')`);
  check("prévia do parcelamento", (await ev(`document.querySelector('[data-split-preview]').textContent`)).includes("3 parcelas"));
  await b.type("#plan-description", `${P} Curso`);
  await choose("areaId", `${P} Clínica`);
  await submit();
  check("criar parcelamento no Pix", await waitNotice(`Parcelamento criado. A 1ª parcela vence em ${br(today)}`), await notice());
  check("parcela 1 de 3 aparece com Pix", /Parcela 1 de 3/.test(await row(`${P} Curso`)) && /Pix/.test(await row(`${P} Curso`)), await row(`${P} Curso`));

  // ---------------- Compra no cartão ----------------
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await choose("method", `${P} Visa`);
  await b.waitFor(`document.querySelector('#purchase-total')`);
  check("no cartão, a área padrão do cartão já vem escolhida", (await chosen("areaId")) === `${P} Casa`, await chosen("areaId"));
  await b.type("#purchase-total", "1.000,00");
  await b.type("#purchase-count", "4");
  await b.waitFor(`document.querySelector('[data-purchase-summary]')`, 15000);
  const preview = norm(await ev(`document.querySelector('[data-purchase-preview]').innerText`));
  check("prévia: total, parcelas e vencimentos", preview.includes("R$ 1.000,00 em 4 parcelas") && preview.includes(br(firstDue)), preview);
  check("sem a palavra fatura no formulário", !/fatura/i.test(await ev(`document.querySelector('[role=dialog]').innerText`)));
  await b.type("#purchase-description", `${P} Geladeira`);
  await submit();
  check("lançar compra: o aviso diz quando vence a 1ª parcela", await waitNotice(`Compra lançada em 4 parcelas. A 1ª vence em ${br(firstDue)}`), await notice());
  await b.goto(`/financas/mes?mes=${firstDueMonth}`);
  const visa = `${P} Visa`;
  let card = await cardText(visa);
  check("compra aparece no Mês do vencimento, debaixo da linha do cartão: parcela e valor", card.includes(visa) && card.includes(`${P} Geladeira`) && card.includes("Parcela 1 de 4") && card.includes("R$ 250,00"), card);
  check("linha do cartão: vencimento, total = soma das compras e aviso de total não informado", (await cardPart(visa, "[data-card-total]")) === "R$ 250,00" && (await cardPart(visa, "[data-card-meta]")) === `Vence ${br(firstDue).slice(0, 5)} · total da fatura não informado`, await cardPart(visa, "[data-card-meta]"));
  check(
    "o pagamento fica na linha do cartão; a compra não tem botão de pagar",
    (await ev(`${cardGroup(visa)}.querySelectorAll('[data-pay]').length`)) === 1 && (await rowAttr(`${P} Geladeira`, "data-row")) === "cartao" && !(await ev(`!![...document.querySelectorAll('[data-charge-id]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Geladeira`)}))?.querySelector('[data-pay]')`)),
  );
  // Segunda compra, de OUTRA área, no mesmo cartão e vencimento: fica no mesmo bloco, com um pagamento só.
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await choose("method", visa);
  await b.waitFor(`document.querySelector('#purchase-total')`);
  await b.type("#purchase-total", "300,00");
  await b.waitFor(`document.querySelector('[data-purchase-summary]')`, 15000);
  await b.type("#purchase-description", `${P} Monitor`);
  await choose("areaId", `${P} Clínica`);
  await submit();
  check("segunda compra no mesmo cartão, em outra área", await waitNotice(`Compra lançada. Vence em ${br(firstDue)}`), await notice());
  card = await cardText(visa);
  check(
    "as duas compras ficam juntas debaixo do mesmo cartão, cada uma com a sua área; um bloco e um pagamento",
    card.includes(`${P} Geladeira`) && card.includes(`${P} Monitor`) && card.includes(`${P} Casa`) && card.includes(`${P} Clínica`) && (await cardPart(visa, "[data-card-total]")) === "R$ 550,00" &&
      (await ev(`[...document.querySelectorAll('[data-card-group]')].filter(s => s.textContent.includes(${JSON.stringify(visa)})).length`)) === 1 && (await ev(`${cardGroup(visa)}.querySelectorAll('[data-pay]').length`)) === 1,
    card,
  );
  check("totais do mês: Total = Pago + A pagar, com o cartão dentro (sem 'No cartão' à parte)", JSON.stringify(await totals()) === JSON.stringify({ total: "R$ 750,00", pago: "R$ 0,00", "a-pagar": "R$ 750,00" }), await totals());
  await chip("Área", ids[`${P} Clínica`]);
  card = await cardText(visa);
  check(
    "filtro de área: o cartão mostra só as compras da área e a soma delas, sem repetir a fatura inteira",
    card.includes(`${P} Monitor`) && !card.includes(`${P} Geladeira`) && (await cardPart(visa, "[data-card-total]")) === "R$ 300,00" && card.includes("só as compras desta área") && card.includes("+ 1 compra de outra área"),
    card,
  );
  check("resumo da área: contas dela (R$ 200,00) + compras dela no cartão (R$ 300,00)", (await totals())["a-pagar"] === "R$ 500,00", await totals());
  await chip("Área", ids[`${P} Casa`]);
  check("resumo da outra área: só a compra dela no cartão (R$ 250,00)", (await totals())["a-pagar"] === "R$ 250,00", await totals());
  await chip("Área", "todas");

  // Total real da fatura (o usuário não lança todas as compras do cartão).
  await clickInCard(visa, 'button[aria-label^="Abrir fatura"]');
  await b.waitFor(`document.querySelector('#invoice-total')`);
  check("diálogo da fatura: campo vazio, com a soma das compras como referência", (await ev(`document.querySelector('#invoice-total').value`)) === "" && norm(await ev(`document.querySelector('[data-invoice-breakdown]').innerText`)).includes("Compras cadastradas R$ 550,00"));
  await b.type("#invoice-total", "500,00");
  check("total menor que as compras: a divergência aparece antes de salvar", await b.waitFor(`(document.querySelector('[data-invoice-lower]')?.textContent ?? '').replace(/\\u00a0/g, ' ').includes('Menor que as compras cadastradas em R$ 50,00')`, 5000));
  await b.type("#invoice-total", "2.500,00");
  check("total maior: a diferença aparece como outros valores da fatura", await b.waitFor(`(document.querySelector('[data-invoice-difference]')?.textContent ?? '').replace(/\\u00a0/g, ' ') === 'R$ 1.950,00'`, 5000));
  await submit();
  check("informar o total real da fatura", await waitNotice("Total da fatura salvo."), await notice());
  card = await cardText(visa);
  check(
    "linha do cartão passa a valer o total real; as compras continuam iguais e a diferença fica identificada",
    (await cardPart(visa, "[data-card-total]")) === "R$ 2.500,00" && (await cardPart(visa, "[data-card-meta]")) === `Vence ${br(firstDue).slice(0, 5)}` && card.includes("R$ 250,00") && card.includes("R$ 300,00") && norm(await ev(`${cardGroup(visa)}.querySelector('[data-remainder]').innerText`)) === "Outros valores da fatura R$ 1.950,00",
    card,
  );
  check("total do mês usa o total real, uma vez só (R$ 200,00 de contas + R$ 2.500,00)", JSON.stringify(await totals()) === JSON.stringify({ total: "R$ 2.700,00", pago: "R$ 0,00", "a-pagar": "R$ 2.700,00" }), await totals());

  // Pagamento na linha do cartão.
  await clickInCard(visa, "[data-pay]");
  await b.waitFor(`document.querySelector('[data-invoice-form=pagar]')`);
  check("pagar: mostra o cartão, o vencimento, o total que será registrado e sugere hoje", norm(await ev(`document.querySelector('[role=dialog]').innerText`)).includes(`${visa} · vence em ${br(firstDue)}`) && (await ev(`document.querySelector('#invoice-total').value`)) === "2.500,00" && (await ev(`document.querySelector('#invoice-pay-date').value`)) === today);
  await b.setValue("#invoice-pay-date", addDays(today, 1));
  await submit();
  await b.waitFor(`document.getElementById('invoice-pay-date-erro')`);
  check("data de pagamento futura é recusada também no cartão", (await fieldError("invoice-pay-date")) === "A data de pagamento não pode ser futura.");
  await b.setValue("#invoice-pay-date", today);
  await submit();
  check("marcar o cartão como pago", await waitNotice("Cartão marcado como pago."), await notice());
  check("linha do cartão fica paga, com a data", (await cardAttr(visa, "data-status")) === "pago" && (await cardPart(visa, "[data-card-meta]")) === `Paga em ${br(today)}`, await cardPart(visa, "[data-card-meta]"));
  check("o valor passa de A pagar para Pago, sem mudar o total", JSON.stringify(await totals()) === JSON.stringify({ total: "R$ 2.700,00", pago: "R$ 2.500,00", "a-pagar": "R$ 200,00" }), await totals());
  await chip("Situação", "pagas");
  check("situação Pagas mostra o cartão pago e esconde as contas a pagar", (await cardText(visa)).includes(visa) && (await row(`${P} Internet`)) === null);
  await chip("Situação", "a-pagar");
  check("situação A pagar esconde o cartão pago", (await cardText(visa)) === "" && (await row(`${P} Internet`)) !== null);
  await chip("Situação", "todas");
  await b.goto(`/financas?mes=${firstDueMonth}`);
  check("Visão geral do mês: mesmos totais da aba Mês", JSON.stringify(await stats()) === JSON.stringify({ total: "R$ 2.700,00", pago: "R$ 2.500,00", "a-pagar": "R$ 200,00" }), await stats());
  check("gráfico por forma mostra o cartão pelo total real", (await bars("grafico-formas")).some((x) => x.startsWith(`${visa} R$ 2.500,00`)), await bars("grafico-formas"));
  const porArea = await bars("grafico-areas");
  check(
    "gráfico por área: as compras nas suas áreas e a parte sem compra cadastrada identificada",
    porArea.some((x) => x.startsWith("Cartão, sem detalhe R$ 1.950,00")) && porArea.some((x) => x.startsWith(`${P} Clínica R$ 500,00`)) && porArea.some((x) => x.startsWith(`${P} Casa R$ 250,00`)),
    porArea,
  );
  check("gráfico por categoria também identifica a parte sem detalhe", (await bars("grafico-categorias")).some((x) => x.startsWith("Cartão, sem detalhe R$ 1.950,00")), await bars("grafico-categorias"));
  check(
    "sem plantões nem perícias lançados, a Visão geral mostra só as saídas: sem entradas, resultado nem legenda de duas séries",
    JSON.stringify(Object.keys(await flow())) === JSON.stringify(["saidas", "pago", "a-pagar"]) &&
      (await ev(`document.querySelector('[data-chart=grafico-evolucao] h3')?.textContent`)) === "Saídas por mês" &&
      !(await ev(`!!document.querySelector('[data-chart=grafico-evolucao] ul[aria-label=Legenda]')`)) &&
      !(await ev(`!!document.querySelector('[data-chart=grafico-entradas]')`)),
    await flow(),
  );
  await b.goto(`/financas?mes=${firstDueMonth}&area=${ids[`${P} Casa`]}`);
  check("Visão geral filtrada por área: só o que é dela (a compra de R$ 250,00, já paga)", JSON.stringify(await stats()) === JSON.stringify({ total: "R$ 250,00", pago: "R$ 250,00", "a-pagar": "R$ 0,00" }), await stats());
  // O vencimento seguinte do mesmo cartão não foi tocado.
  await b.goto(`/financas/mes?mes=${addMonths(firstDueMonth, 1)}`);
  check("pagar um vencimento não altera o seguinte", (await cardAttr(visa, "data-status")) === "pendente" && (await cardPart(visa, "[data-card-total]")) === "R$ 250,00" && (await cardText(visa)).includes("Parcela 2 de 4"), await cardText(visa));
  // Desfazer o pagamento.
  await b.goto(`/financas/mes?mes=${firstDueMonth}`);
  await clickInCard(visa, 'button[aria-label^="Abrir fatura"]');
  await b.waitFor(`document.querySelector('[data-invoice-form=paga]')`);
  check("fatura paga: o total não é editável sem voltar para a pagar", !(await ev(`!!document.querySelector('#invoice-total')`)) && norm(await ev(`document.querySelector('[role=dialog]').innerText`)).includes("R$ 2.500,00"));
  await press("Escape");
  await b.waitFor(`!document.querySelector('[role=dialog]')`);
  await clickInCard(visa, "[data-pay]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Voltar para a pagar", "[role=alertdialog]");
  check("desfazer o pagamento do cartão (com confirmação)", await waitNotice("Cartão voltou para a pagar."), await notice());
  check("cartão volta para a pagar e mantém o total informado", (await cardAttr(visa, "data-status")) === "pendente" && (await cardPart(visa, "[data-card-total]")) === "R$ 2.500,00" && (await totals())["a-pagar"] === "R$ 2.700,00", await totals());
  await b.goto(`/financas/mes?mes=${addMonths(firstDueMonth, 3)}`);
  check("4ª parcela no 4º mês", (await row(`${P} Geladeira`))?.includes("Parcela 4 de 4"), await row(`${P} Geladeira`));

  // ---------------- Visão geral ----------------
  await b.goto(`/financas?mes=${thisMonth}&area=${ids[`${P} Clínica`]}`);
  check("Visão geral filtrada pela área: totais", JSON.stringify(await stats()) === JSON.stringify({ total: "R$ 200,00", pago: "R$ 0,00", "a-pagar": "R$ 200,00" }), await stats());
  check("gráfico por forma de pagamento: Pix e Boleto meio a meio", JSON.stringify((await bars("grafico-formas")).sort()) === JSON.stringify(["Boleto R$ 100,00 50%", "Pix R$ 100,00 50%"]), await bars("grafico-formas"));
  check("com uma área filtrada, o gráfico por área não aparece", !(await ev(`!!document.querySelector('[data-chart=grafico-areas]')`)));
  check("evolução com 12 meses e o mês escolhido em destaque", (await ev(`document.querySelectorAll('[data-chart=grafico-evolucao] [data-month]').length`)) === 12);
  check("tabela de valores da evolução disponível", await ev(`!!document.querySelector('[data-chart=grafico-evolucao] details table')`));
  await b.setValue("[data-filter=forma]", "pix");
  await b.waitFor(`location.search.includes('forma=pix')`, 20000);
  await b.settle(800);
  check("filtro de forma (Pix) recalcula os totais e esconde o gráfico por forma", (await stats()).total === "R$ 100,00" && !(await ev(`!!document.querySelector('[data-chart=grafico-formas]')`)), await stats());
  await b.click("Limpar filtros");
  await b.waitFor(`!location.search.includes('forma=') && !location.search.includes('area=')`, 20000);
  await b.settle(800);
  await b.goto(`/financas?mes=${firstDueMonth}&area=${ids[`${P} Casa`]}`);
  check("Visão geral no mês do vencimento, filtrada pela área: a compra do cartão entra em A pagar", (await stats())["a-pagar"] === "R$ 250,00" && (await stats()).total === "R$ 250,00", await stats());
  check("gráfico por forma mostra o cartão", (await bars("grafico-formas")).some((x) => x.startsWith(`${P} Visa R$ 250,00`)), await bars("grafico-formas"));
  await b.goto(`/financas?mes=${thisMonth}`);
  check("sem filtro de área, aparece o gráfico por área", await ev(`!!document.querySelector('[data-chart=grafico-areas]')`));
  await ev(`[...document.querySelectorAll('[aria-label=Período] a')].find(a => a.textContent.trim() === 'Ano').click()`);
  await b.waitFor(`location.search.includes('periodo=ano')`, 20000);
  await b.settle(800);
  const months = await ev(`[...document.querySelectorAll('[data-chart=grafico-evolucao] [data-month]')].map(a => a.dataset.month)`);
  check("visão por ano: rótulo do ano e evolução de janeiro a dezembro", (await ev(`document.querySelector('[data-period-label]').textContent`)) === today.slice(0, 4) && months[0] === `${today.slice(0, 4)}-01` && months[11] === `${today.slice(0, 4)}-12`, months);

  // ---------------- Pagar, voltar, situação e área ----------------
  await b.goto(`/financas/mes?mes=${thisMonth}`);
  const pay = async (desc) => ev(`[...document.querySelectorAll('[data-entry-id]')].find(li => li.textContent.includes(${JSON.stringify(desc)})).querySelector('[data-pay]').click()`);
  await pay(`${P} Aluguel`);
  await b.waitFor(`document.querySelector('#pay-date')`);
  check("pagamento sugere hoje", (await ev(`document.querySelector('#pay-date').value`)) === today);
  await b.setValue("#pay-date", addDays(today, 1));
  await submit();
  await b.waitFor(`document.getElementById('pay-date-erro')`);
  check("data de pagamento futura é recusada", (await fieldError("pay-date")) === "A data de pagamento não pode ser futura.");
  await b.setValue("#pay-date", today);
  await submit();
  check("marcar como paga com um toque e a data", await waitNotice("Conta marcada como paga."), await notice());
  check("linha mostra 'Paga em' hoje", (await rowAttr(`${P} Aluguel`, "data-status")) === "pago" && (await row(`${P} Aluguel`))?.includes(`Paga em ${br(today)}`), await row(`${P} Aluguel`));
  await chip("Situação", "pagas");
  check("situação Pagas lista só a paga", (await row(`${P} Aluguel`)) !== null && (await row(`${P} Internet`)) === null);
  await chip("Situação", "a-pagar");
  check("situação A pagar lista as pendentes", (await row(`${P} Internet`)) !== null && (await row(`${P} Curso`)) !== null && (await row(`${P} Aluguel`)) === null);
  await chip("Situação", "todas");
  await pay(`${P} Aluguel`);
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Voltar para a pagar", "[role=alertdialog]");
  check("voltar para a pagar (com confirmação)", await waitNotice("Conta voltou para pendente."), await notice());
  await chip("Área", ids[`${P} Clínica`]);
  check("área escolhida: só as contas dela, sem cabeçalho de área", (await row(`${P} Aluguel`)) === null && (await row(`${P} Internet`)) !== null && !(await ev(`!!document.querySelector('[data-area-group] h3')`)));
  check("resumo da área: A pagar R$ 200,00", (await totals())["a-pagar"] === "R$ 200,00", await totals());
  await chip("Área", "todas");
  check("todas as áreas: cada área em seu bloco com o próprio total", (await ev(`document.querySelectorAll('[data-area-group] h3').length`)) >= 2);

  // ---------------- Editar e excluir ----------------
  await b.click(`Abrir ${P} Aluguel`);
  await b.waitFor(`document.querySelector('[role=dialog] input[name=paymentMethod]')`);
  await choose("paymentMethod", "Boleto");
  await submit();
  check("editar a forma de pagamento da conta", await waitNotice("Conta atualizada."), await notice());
  check("linha mostra Boleto", (await row(`${P} Aluguel`))?.includes("Boleto"), await row(`${P} Aluguel`));
  await b.click(`Abrir ${P} Aluguel`);
  await b.waitFor(`document.querySelector('[role=dialog] form')`);
  await b.click("Excluir", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Excluir", "[role=alertdialog]");
  check("excluir conta pelo diálogo (com confirmação)", await waitNotice("Conta excluída."), await notice());
  check("conta excluída sai do mês", (await row(`${P} Aluguel`)) === null);

  await b.click(`Abrir ${P} Internet`);
  await b.waitFor(`[...document.querySelectorAll('[role=dialog] button')].some(x => x.textContent.includes('Esta e as próximas'))`);
  const scopes = await ev(`[...document.querySelectorAll('[role=dialog] ul button span:first-child')].map(s => s.textContent)`);
  check("conta recorrente oferece: só esta, esta e as próximas, futuras e encerrar", JSON.stringify(scopes) === JSON.stringify(["Só esta conta", "Esta e as próximas", "Todas as futuras", "Encerrar a recorrência"]), scopes);
  await b.click("Esta e as próximas", "[role=dialog]");
  await b.waitFor(`document.querySelector('#series-amount')`);
  await b.type("#series-amount", "120,00");
  await choose("paymentMethod", "Pix");
  await b.waitFor(`![...document.querySelectorAll('[role=dialog] button[type=submit]')].at(-1).disabled`);
  await submit();
  check("alterar esta e as próximas, com nova forma de pagamento", await waitNotice("Recorrência alterada a partir da data escolhida."), await notice());
  check("ocorrência com o novo valor e Pix", (await row(`${P} Internet`))?.includes("R$ 120,00") && (await row(`${P} Internet`)).includes("Pix"), await row(`${P} Internet`));

  // ---------------- Compra: editar e excluir ----------------
  await b.goto(`/financas/mes?mes=${firstDueMonth}`);
  await b.click(`Abrir compra ${P} Geladeira`);
  await b.waitFor(`document.querySelector('#purchase-edit-description')`);
  check("diálogo da compra explica o total e as parcelas", norm(await ev(`document.querySelector('[role=dialog]').innerText`)).includes("R$ 1.000,00 em 4x"));
  await b.type("#purchase-edit-description", `${P} Geladeira nova`);
  await submit();
  check("editar compra no cartão", await waitNotice("Compra atualizada."), await notice());
  check("nova descrição na parcela", (await row(`${P} Geladeira nova`)) !== null);
  await b.click(`Abrir compra ${P} Geladeira nova`);
  await b.waitFor(`document.querySelector('#purchase-edit-description')`);
  await rememberPurchases(`${P} Geladeira nova`);
  await b.click("Excluir compra", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Excluir compra", "[role=alertdialog]");
  check("excluir compra com todas as parcelas", await waitNotice("Compra excluída com todas as parcelas."), await notice());
  await b.goto(`/financas/mes?mes=${addMonths(firstDueMonth, 3)}`);
  check("a 4ª parcela também sumiu", (await row(`${P} Geladeira`)) === null);

  // ---------------- Recorrências ----------------
  await b.goto("/financas/recorrencias");
  check("Recorrências lista a recorrente e o parcelamento", (await body()).includes(`${P} Internet`) && (await body()).includes(`${P} Curso`));
  check("parcelamento mostra quanto falta", (await ev(`[...document.querySelectorAll('[data-plan]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Curso`)}))?.innerText ?? ''`)).includes("faltam 3"));
  await b.openMenu(`Ações: ${P} Curso`);
  await b.menuItem("Forma de pagamento");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=paymentMethod]')`);
  await choose("paymentMethod", "Boleto");
  await submit();
  check("mudar a forma do parcelamento vale para as 3 parcelas a pagar", await waitNotice("Forma de pagamento aplicada a 3 parcelas pendentes."), await notice());
  await b.openMenu(`Ações: ${P} Internet`);
  await b.menuItem("Encerrar");
  await b.waitFor(`document.querySelector('#end-date')`);
  await submit();
  check("encerrar recorrência pelo menu", await waitNotice("Recorrência encerrada."), await notice());
  check("recorrência encerrada sai da lista", !(await ev(`[...document.querySelectorAll('[data-series]')].some(li => li.textContent.includes(${JSON.stringify(`${P} Internet`)}))`)));
  // Botão "Nova recorrência" na própria aba: abre direto o cadastro de conta recorrente.
  await b.click("Nova recorrência");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  check(
    "Nova recorrência: só Pix e Boleto, sem a escolha uma vez/recorrente/parcelada",
    (await ev(`document.querySelector('[role=dialog] h2')?.textContent`)) === "Nova recorrência" && JSON.stringify(await chipsOf("method")) === JSON.stringify(["Pix", "Boleto"]),
    await chipsOf("method"),
  );
  await choose("method", "Pix");
  await b.waitFor(`document.querySelector('#series-amount')`);
  check("abre direto os campos da recorrência (valor fixo ou variável, periodicidade e início)", !(await ev(`!!document.querySelector('[role=dialog] input[name=kind]')`)) && (await ev(`!!document.querySelector('[role=dialog] input[name=amountKind]') && !!document.querySelector('#series-start')`)));
  await b.type("#series-amount", "55,00");
  await b.type("#series-description", `${P} Streaming`);
  await b.setValue("#series-start", today);
  await choose("areaId", `${P} Clínica`);
  await ev(`(() => { const btn = [...document.querySelectorAll('[role=dialog] form button[type=submit]')].at(-1); btn.click(); btn.click(); })()`);
  check("criar recorrência pelo botão da aba (duplo clique)", await waitNotice("Recorrência criada."), await notice());
  await b.settle(800);
  check(
    "continua em Recorrências, com a nova recorrência na lista uma única vez",
    (await ev("location.pathname")) === "/financas/recorrencias" && (await ev(`[...document.querySelectorAll('[data-series]')].filter(li => li.textContent.includes(${JSON.stringify(`${P} Streaming`)})).length`)) === 1,
    await ev(`[...document.querySelectorAll('[data-series]')].map(li => li.innerText.split('\\n')[0])`),
  );

  // ---------------- Valor variável e área arquivada com recorrência ----------------
  await b.goto(`/financas/mes?mes=${thisMonth}`);
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await choose("method", "Boleto");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=kind]')`);
  await choose("kind", "Recorrente");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=amountKind]')`);
  await choose("amountKind", "Muda a cada vez");
  await b.type("#series-description", `${P} Água`);
  await b.setValue("#series-start", today);
  await choose("areaId", `${P} Casa`);
  await submit();
  check("criar recorrência de valor variável", await waitNotice("Recorrência criada."), await notice());
  check("variável aparece como 'Valor a informar', sem botão de pagar", (await row(`${P} Água`))?.includes("Valor a informar") && (await ev(`[...document.querySelectorAll('[data-entry-id]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Água`)})).querySelector('[data-pay]').dataset.pay`)) === "valor");
  await pay(`${P} Água`);
  await b.waitFor(`document.querySelector('#amount-value')`);
  await b.type("#amount-value", "80,00");
  await submit();
  check("informar o valor do mês", await waitNotice("Valor informado."), await notice());
  check("depois de informado, a conta pode ser paga", (await row(`${P} Água`))?.includes("R$ 80,00") && (await ev(`[...document.querySelectorAll('[data-entry-id]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Água`)})).querySelector('[data-pay]').dataset.pay`)) === "pagar");
  await b.goto("/financas/areas");
  await b.click(`Editar ${P} Casa`);
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.click("Arquivar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  check("arquivar área avisa que a recorrência para de gerar contas", (await ev(`document.querySelector('[role=alertdialog]').innerText`)).includes("1 recorrência para de gerar contas"));
  await b.click("Arquivar", "[role=alertdialog]");
  check("arquivar área com recorrência ativa", await waitNotice("Área arquivada."), await notice());
  await b.goto("/financas/recorrencias");
  check("recorrência da área arquivada aparece como Suspensa", (await ev(`[...document.querySelectorAll('[data-series]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Água`)}))?.innerText ?? ''`)).includes("Suspensa"));
  await b.openMenu(`Ações: ${P} Água`);
  check("com a área arquivada, retomar fica indisponível", !(await b.menuItem("Retomar")));
  await press("Escape");
  await b.goto("/financas/areas");
  await b.click(`Editar ${P} Casa`);
  await b.waitFor(`document.querySelector('#area-name')`);
  await b.click("Restaurar", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Restaurar", "[role=alertdialog]");
  check("restaurar a área", await waitNotice("Área restaurada."), await notice());
  await b.goto("/financas/recorrencias");
  await b.openMenu(`Ações: ${P} Água`);
  await b.menuItem("Retomar");
  await b.waitFor(`document.querySelector('#resume-date')`);
  await submit();
  check("retomar a recorrência com data", await waitNotice("Recorrência retomada."), await notice());
  check("recorrência deixa de estar suspensa", !(await ev(`[...document.querySelectorAll('[data-series]')].find(li => li.textContent.includes(${JSON.stringify(`${P} Água`)}))?.innerText ?? ''`)).includes("Suspensa"));

  // ---------------- Fatura sem compras cadastradas ----------------
  const master = `${P} Master`;
  await b.goto(`/financas/mes?mes=${thisMonth}`);
  check("cartão sem nada no mês não ocupa a lista: só um botão para informar a fatura", (await cardText(master)) === "" && (await ev(`[...document.querySelectorAll('[data-new-invoice]')].some(x => x.textContent.includes(${JSON.stringify(master)}))`)));
  await b.click(`Fatura do ${master}`);
  await b.waitFor(`document.querySelector('#invoice-total')`);
  await submit();
  await b.waitFor(`document.getElementById('invoice-total-erro')`);
  check("fatura nova exige o total", (await fieldError("invoice-total")) === "Informe o total da fatura.", await fieldError("invoice-total"));
  await b.type("#invoice-total", "800,00");
  await submit();
  check("informar o total de uma fatura sem compras cadastradas", await waitNotice(`Total da fatura salvo. Vence em 20/${thisMonth.slice(5)}/${thisMonth.slice(0, 4)}`), await notice());
  check(
    "o cartão aparece no mês pelo total informado, tudo como valor sem detalhe; o botão some",
    (await cardPart(master, "[data-card-total]")) === "R$ 800,00" && norm(await ev(`${cardGroup(master)}.querySelector('[data-remainder]').innerText`)) === "Outros valores da fatura R$ 800,00" && !(await ev(`[...document.querySelectorAll('[data-new-invoice]')].some(x => x.textContent.includes(${JSON.stringify(master)}))`)),
    await cardText(master),
  );
  await b.goto(`/financas/mes?mes=${addMonths(thisMonth, 1)}`);
  check("o total informado vale só para aquele vencimento (não é copiado para o mês seguinte)", (await cardText(master)) === "");
  await b.goto(`/financas/mes?mes=${thisMonth}`);
  await rememberInvoices(master);
  await clickInCard(master, 'button[aria-label^="Abrir fatura"]');
  await b.waitFor(`document.querySelector('#invoice-total')`);
  await b.type("#invoice-total", "");
  await submit();
  check("limpar o total de uma fatura sem compras tira o cartão do mês", (await waitNotice("Fatura removida do mês")) && (await cardText(master)) === "", await notice());

  // ---------------- Cartão sem vínculos: excluir ----------------
  await b.goto("/financas/formas-de-pagamento");
  await b.click(`Editar ${P} Master`);
  await b.waitFor(`document.querySelector('#card-name')`);
  await b.click("Excluir", "[role=dialog]");
  await b.waitFor(`document.querySelector('[role=alertdialog]')`);
  await b.click("Excluir", "[role=alertdialog]");
  check("excluir cartão sem compras", await waitNotice("Cartão excluído."), await notice());

  // ---------------- Celular ----------------
  await b.viewport(375, 812);
  for (const path of [`/financas/mes?mes=${thisMonth}`, `/financas?mes=${thisMonth}`, "/financas/formas-de-pagamento", "/financas/recorrencias", "/financas/areas"]) {
    await b.goto(path);
    const m = await ev(`(() => { const d = document.documentElement; const pays = [...document.querySelectorAll('[data-pay]')].filter(e => e.offsetParent !== null);
      return { h: d.scrollWidth > d.clientWidth, toque: pays.length ? Math.min(...pays.map(e => e.getBoundingClientRect().height)) : 40 }; })()`);
    check(`375px ${path}: sem rolagem horizontal; alvos de toque ≥ 40 px`, !m.h && m.toque >= 40, m);
  }
  await b.viewport(1280, 900);

  // ---------------- Isolamento ----------------
  await b.logout();
  await b.login(B);
  for (const path of [`/financas/mes?mes=${thisMonth}`, `/financas?mes=${thisMonth}`, "/financas/recorrencias", "/financas/formas-de-pagamento", "/financas/areas"]) {
    await b.goto(path);
    check(`B não vê nada de A em ${path}`, !(await body()).includes(P));
  }
  await b.goto("/financas/recorrencias");
  check("o botão Nova recorrência aparece também com a lista vazia", await ev(`!!document.querySelector('[data-new-series]')`));
  await b.logout();
} catch (error) {
  check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  const removed = await cleanup().catch((e) => `falhou (${e.code ?? e.message})`);
  t.info(`limpeza final: ${removed} registro(s) de teste removidos`);
  t.print();
  console.log(`\nconsole: ${b.consoleIssues.length ? `${b.consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(t.failures ? `${t.failures} falha(s).` : "Todos os fluxos de Finanças passaram.");
  await b.close();
}
process.exit(t.failures ? 1 : 0);
