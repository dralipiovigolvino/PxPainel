// Fluxos de Plantões (Etapas 10 a 12) na APLICAÇÃO, com Neon Auth e Neon reais.
// Conta fictícia A (B para isolamento); tipos "[teste-e2e]" FICTÍCIOS, removidos ao final com tudo que depende deles.
// Uso: npm run test:e2e:plantoes -- [etapa10] [etapa11] [etapa12]   (sem argumentos = todas)
// Capturas opcionais: E2E_SHOTS_DIR=<pasta>.

import { Pool } from "@neondatabase/serverless";
import { createChecks, sleep, startBrowser } from "./lib/browser.mjs";

const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD, id: process.env.RLS_TEST_A_ID };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const P = "[teste-e2e]";
const wanted = new Set(process.argv.slice(2));
const run = (stage) => wanted.size === 0 || wanted.has(stage);

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const ym = today.slice(0, 7);
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMonthsYm = (value, n) => {
  const [y, m] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const br = (civil) => civil.split("-").reverse().join("/");
const norm = (s) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const runStart = new Date(Date.now() - 5000).toISOString();

/** Remove só os dados de teste da conta A (tipos "[teste-e2e]" e tudo que depende deles). */
async function cleanup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  const c = await pool.connect();
  let removed = 0;
  const exists = async (t) => (await c.query("select to_regclass($1) is not null as ok", [`public.${t}`])).rows[0].ok;
  try {
    await c.query("begin");
    const types = (await c.query("select id from public.pl_types where user_id = $1 and name like $2", [A.id, `${P}%`])).rows.map((r) => r.id);
    removed += (await c.query(
      "delete from public.pl_events where user_id = $1 and (type_id = any($2::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($2::uuid[])) or created_at >= $3::timestamptz)",
      [A.id, types, runStart],
    )).rowCount ?? 0;
    removed += (await c.query("delete from public.pl_shifts where type_id = any($1::uuid[])", [types])).rowCount ?? 0;
    if (await exists("pl_series")) {
      removed += (await c.query("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [types])).rowCount ?? 0;
      removed += (await c.query("delete from public.pl_series where type_id = any($1::uuid[])", [types])).rowCount ?? 0;
    }
    removed += (await c.query("delete from public.pl_types where id = any($1::uuid[])", [types])).rowCount ?? 0;
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => {});
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
  return removed;
}

/** Inserções fictícias com o PAPEL DO APP (contexto de A), para cenários volumosos. */
async function asA(fn) {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [A.id]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

const t = createChecks();
const b = await startBrowser({ port: 9342 });
const { ev } = b;
const check = t.check;
const shot = async (name) => process.env.E2E_SHOTS_DIR && b.shot(`${process.env.E2E_SHOTS_DIR}/${name}.png`);

const noticeText = () => ev(`document.querySelector('main [data-notice] p')?.textContent ?? ''`);
const waitNotice = (text) =>
  b.waitFor(`!document.querySelector('[role=dialog], [role=alertdialog]') && document.querySelector('main [data-notice] p')?.textContent === ${JSON.stringify(text)}`, 30000);
const dialogSubmit = () => ev(`document.querySelector('[role=dialog] form button[type=submit]:not([name])').click()`);
const bodyHas = (text) => ev(`document.body.innerText.includes(${JSON.stringify(text)})`);
const selectOption = (selector, startsWith) =>
  ev(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); const o = [...s.options].find(o => o.textContent.startsWith(${JSON.stringify(startsWith)}));
    if (!o) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const escape = async () => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
};
const noOverflow = () =>
  ev(`(() => { const d = document.documentElement; const main = document.querySelector('main'); const r = main.getBoundingClientRect().right;
    const over = [...main.querySelectorAll('*')].filter(el => el.offsetParent !== null && el.getBoundingClientRect().right > r + 1).length;
    return { h: d.scrollWidth > d.clientWidth, over }; })()`);
const dots = (date) => ev(`[...document.querySelectorAll('[data-day-dots="${date}"] [data-shift-dot]')].map(d => d.getAttribute('aria-label'))`);
const clickDot = (date, index = 0) => ev(`(() => { const d = document.querySelectorAll('[data-day-dots="${date}"] [data-shift-dot]')[${index}]; d?.click(); return !!d; })()`);
const details = () => ev(`(document.querySelector('[data-shift-details]')?.innerText ?? '').replace(/\\u00a0/g, ' ')`);

async function createType(name, { amount, color, start = "", end = "", nextDay = false, location = "", payDay = "" }) {
  await b.goto("/plantoes/tipos");
  await b.click("Novo tipo");
  await b.waitFor(`document.querySelector('#type-name')`);
  await b.type("#type-name", name);
  if (location) await b.type("#type-location", location);
  await b.type("#type-amount", amount);
  // "Recebo por CNPJ" fica desmarcado: estes cenários são de plantões sem CNPJ.
  if (payDay) await b.type("#type-pay-day", payDay);
  await b.click(color, "[role=dialog]");
  if (start) await b.setValue("#type-start", start);
  if (end) await b.setValue("#type-end", end);
  if (nextDay) await ev(`document.querySelector('[role=dialog] [data-next-day]').click()`);
  await dialogSubmit();
  return waitNotice("Tipo de plantão criado.");
}

/** Abre o formulário pelo dia do calendário e escolhe o tipo. */
async function openDay(date, typeName) {
  await b.goto(`/plantoes?mes=${date.slice(0, 7)}`);
  await ev(`document.querySelector('[data-day="${date}"]').click()`);
  await b.waitFor(`document.querySelector('#shift-type')`);
  await selectOption("#shift-type", typeName);
  await b.waitFor(`document.querySelector('#shift-amount')`);
}

try {
  t.info(`limpeza prévia: ${await cleanup()} registro(s)`);
  await b.viewport(1280, 900);
  await b.login(A);

  // -------------------------------------------------------------------------
  if (run("etapa10")) {
    t.info("— Etapa 10: tipos e calendário —");
    await b.goto("/plantoes");
    check("sem tipos: nenhum plantão pré-cadastrado e 'Novo plantão' desativado", !(await bodyHas(P)) && (await ev(`[...document.querySelectorAll('button')].find(x => x.textContent.includes('Novo plantão'))?.disabled === true`)));

    const norte = `${P} Hospital Norte`;
    const noturno = `${P} Noturno`;
    const h24 = `${P} Plantão 24h`;
    await b.goto("/plantoes/tipos");
    await b.click("Novo tipo");
    await b.waitFor(`document.querySelector('#type-name')`);
    await b.type("#type-name", norte);
    await b.type("#type-amount", "1.200,00");
    await b.setValue("#type-start", "07:00");
    await dialogSubmit();
    check("horário pela metade é recusado junto ao campo", await b.waitFor(`(document.getElementById('type-end-erro')?.textContent ?? '').includes('Informe o fim junto com o início')`));
    await b.setValue("#type-end", "19:00");
    check("prévia da duração (12 h)", await b.waitFor(`document.querySelector('[data-hours-preview]')?.textContent === '07:00 → 19:00 (12 h)'`));
    await b.type("#type-location", "Hospital Fictício Norte");
    await dialogSubmit();
    check("criar tipo diurno", await waitNotice("Tipo de plantão criado."), await noticeText());
    check("criar tipo noturno (termina no dia seguinte)", await createType(noturno, { amount: "1.500,00", color: "Vermelho", start: "19:00", end: "07:00", nextDay: true }));
    check("criar tipo 24 h (07:00 → 07:00 do dia seguinte)", await createType(h24, { amount: "2.400,00", color: "Verde", start: "07:00", end: "07:00", nextDay: true }));
    const typeRow = norm(await ev(`[...document.querySelectorAll('[data-type]')].find(li => li.innerText.includes(${JSON.stringify(h24)}))?.innerText`));
    check("tipo 24 h descrito sem ambiguidade", typeRow.includes("07:00 → 07:00 do dia seguinte (24 h)"), typeRow);

    const d10 = `${ym}-10`;
    const d11 = `${ym}-11`;
    await openDay(d10, norte);
    check("formulário copia valor e horários do tipo", (await ev(`document.querySelector('#shift-amount').value`)) === "1.200,00" && (await ev(`document.querySelector('#shift-start').value`)) === "07:00");
    check("data vem do dia selecionado", (await ev(`document.querySelector('#shift-date').value`)) === d10);
    await ev(`(() => { const btn = document.querySelector('[role=dialog] form button[type=submit]:not([name])'); btn.click(); btn.click(); })()`);
    check("adicionar plantão pelo dia (duplo clique)", await waitNotice("Plantão adicionado."), await noticeText());
    check("duplo clique gerou uma única bolinha", (await dots(d10)).length === 1, await dots(d10));
    await openDay(d10, noturno);
    await dialogSubmit();
    check("segundo plantão no mesmo dia (noturno, encosta sem sobrepor)", await waitNotice("Plantão adicionado."), await noticeText());
    check("dois plantões no dia = duas bolinhas", (await dots(d10)).length === 2, await dots(d10));
    await openDay(d11, h24);
    await dialogSubmit();
    check("plantão de 24 h no dia seguinte (encosta no noturno)", await waitNotice("Plantão adicionado."), await noticeText());
    await openDay(d11, norte);
    await b.setValue("#shift-start", "08:00");
    await b.setValue("#shift-end", "12:00");
    await dialogSubmit();
    check("sobreposição avisa e pede confirmação", await b.waitFor(`document.querySelector('[data-overlap-warning]')?.innerText.includes('Horário sobreposto')`, 20000), await ev(`document.querySelector('[data-overlap-warning]')?.innerText`));
    await ev(`document.querySelector('[data-overlap-warning] button[name=confirmOverlap]').click()`);
    check("confirmar sobreposição adiciona", await waitNotice("Plantão adicionado."), await noticeText());

    const cells = await ev(`[...document.querySelectorAll('td[data-date]')].map(td => [td.dataset.date, td.innerText.replace(/\\s+/g, '')])`);
    check(
      "cada dia mostra só o número (nenhum nome, valor ou texto de evento)",
      cells.every(([date, txt]) => txt === String(Number(date.slice(8)))),
      cells.filter(([date, txt]) => txt !== String(Number(date.slice(8)))).slice(0, 3),
    );
    const labels = await dots(d10);
    check("bolinha tem nome acessível com tipo e data", labels.some((l) => l === `Plantão ${norte} em ${br(d10)}`) && labels.some((l) => l.startsWith(`Plantão ${noturno} em ${br(d10)}`)), labels);
    const color = await ev(`getComputedStyle(document.querySelector('[data-day-dots="${d10}"] [data-shift-dot] span')).backgroundColor`);
    check("bolinha usa a cor do tipo", color === "rgb(37, 99, 235)", color);

    // Teclado: foco na bolinha + Enter abre os detalhes.
    await ev(`document.querySelectorAll('[data-day-dots="${d10}"] [data-shift-dot]')[1].focus(); true`);
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    const det = norm(await details());
    check(
      "detalhes por teclado: nome, data, término no dia seguinte, valor, situação e recebimento",
      det.includes(noturno) && det.includes(`19:00 → 07:00 do dia ${br(addDays(d10, 1))} (12 h)`) && det.includes(`Término ${br(addDays(d10, 1))}`) && det.includes("R$ 1.500,00") && det.includes("Agendado") && det.includes("Data em que recebi Ainda não registrado (a receber)"),
      det,
    );
    check("histórico nos detalhes", await b.waitFor(`document.querySelector('[data-shift-history]')?.innerText.includes('Plantão criado')`, 20000));
    await escape();

    // Editar valor só desta ocorrência; depois mudar o padrão do tipo.
    await b.goto(`/plantoes?mes=${ym}`);
    await clickDot(d10, 0);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Editar", "[role=dialog]");
    await b.waitFor(`document.querySelector('#shift-amount')`);
    await b.type("#shift-amount", "1.250,00");
    await b.type("#shift-notes", "Troca com colega (fictício)");
    await dialogSubmit();
    check("editar valor e observação só deste plantão", await waitNotice("Plantão atualizado."), await noticeText());
    check("bolinha ganha contorno discreto (observação) sem texto", await ev(`document.querySelector('[data-day-dots="${d10}"] [data-shift-dot] span').className.includes('ring-2')`));
    await b.goto("/plantoes/tipos");
    await b.click(`Editar ${norte}`);
    await b.waitFor(`document.querySelector('#type-amount')`);
    await b.type("#type-amount", "1.400,00");
    await dialogSubmit();
    check("mudar valor padrão do tipo", await waitNotice("Tipo atualizado. Plantões já criados mantêm seus valores e horários."), await noticeText());
    await b.goto(`/plantoes?mes=${ym}`);
    await clickDot(d11, 1);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    check("plantão existente manteve o valor (R$ 1.200,00)", norm(await details()).includes("R$ 1.200,00"), norm(await details()));
    await escape();
    await clickDot(d10, 0);
    await b.waitFor(`document.querySelector('[data-shift-history]')?.innerText.includes('Alterado individualmente')`, 20000);
    check("histórico registra a alteração de valor", norm(await ev(`document.querySelector('[data-shift-history]').innerText`)).includes("valor R$ 1.200,00 → R$ 1.250,00"));
    await escape();

    // Cancelar e restaurar
    await clickDot(d11, 1);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Cancelar plantão", "[role=dialog]");
    await b.waitFor(`document.querySelector('[role=alertdialog]')`);
    await b.click("Cancelar plantão", "[role=alertdialog]");
    check("cancelar plantão", await waitNotice("Plantão cancelado. Ele continua no histórico e no filtro de cancelados."), await noticeText());
    check("cancelado sai do calendário padrão", (await dots(d11)).length === 1);
    await b.click("Mostrar cancelados");
    await b.waitFor(`location.search.includes('cancelados=1')`);
    await b.settle();
    check("filtro mostra o cancelado (bolinha vazada, rotulada)", (await dots(d11)).some((l) => l.includes("cancelado")), await dots(d11));
    await ev(`[...document.querySelectorAll('[data-day-dots="${d11}"] [data-shift-dot]')].find(d => d.dataset.status === 'cancelado').click()`);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Restaurar", "[role=dialog]");
    await b.waitFor(`document.querySelector('[role=alertdialog]')`);
    await b.click("Restaurar", "[role=alertdialog]");
    check("restaurar plantão", await waitNotice("Plantão restaurado."), await noticeText());

    // Muitos plantões no mesmo dia: bolinhas sem sobreposição, inclusive no celular.
    const d12 = `${ym}-12`;
    await asA(async (c) => {
      const typeId = (await c.query("select id from public.pl_types where name = $1", [norte])).rows[0].id;
      for (let i = 0; i < 6; i++) await c.query("insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, $3::date, 100000)", [A.id, typeId, d12]);
    });
    for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
      await b.viewport(w, h);
      await b.goto(`/plantoes?mes=${ym}`);
      const layout = await ev(`(() => { const ds = [...document.querySelectorAll('[data-day-dots="${d12}"] [data-shift-dot]')].map(d => d.getBoundingClientRect());
        const td = document.querySelector('td[data-date="${d12}"]').getBoundingClientRect();
        const overlap = ds.some((a, i) => ds.some((c, j) => i < j && a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5));
        const inside = ds.every(r => r.left >= td.left - 0.5 && r.right <= td.right + 0.5);
        return { n: ds.length, overlap, inside, min: Math.min(...ds.map(r => Math.min(r.width, r.height))) }; })()`);
      check(`${w}px: 6 plantões no dia sem sobreposição, dentro da célula, alvo ≥ 28 px`, layout.n === 6 && !layout.overlap && layout.inside && layout.min >= 27.5, layout);
      const m = await noOverflow();
      check(`${w}px /plantoes: sem rolagem horizontal nem conteúdo cortado`, !m.h && m.over === 0, m);
      await shot(`pl-calendario-${w}`);
      await b.goto("/plantoes/tipos");
      const mt = await noOverflow();
      check(`${w}px /plantoes/tipos: sem rolagem horizontal`, !mt.h && mt.over === 0, mt);
    }
    await b.viewport(1280, 900);

    await b.goto(`/plantoes?mes=${ym}`);
    await ev(`document.querySelector('[data-legend]').open = true; true`);
    const legend = norm(await ev(`document.querySelector('[data-legend]').innerText`));
    check("legenda recolhível com nome e cor de cada tipo", legend.includes(norte) && legend.includes(noturno) && legend.includes(h24), legend);

    // Arquivar tipo: some do formulário.
    await b.goto("/plantoes/tipos");
    await b.openMenu(`Ações: ${h24}`);
    await b.menuItem("Arquivar");
    check("arquivar tipo (pelo menu de ações)", await waitNotice("Tipo arquivado."), await noticeText());
    check("tipo arquivado fica no fim da mesma lista, marcado", await ev(`(() => { const rows = [...document.querySelectorAll('[data-type]')]; const i = rows.findIndex(li => li.textContent.includes(${JSON.stringify(h24)})); return i >= 0 && rows[i].hasAttribute('data-archived') && rows.slice(i + 1).every(li => li.hasAttribute('data-archived')); })()`));
    await b.openMenu(`Ações: ${h24}`);
    check("tipo com plantões não oferece excluir", !(await ev(`[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.trim() === 'Excluir')`)));
    await escape();
    await b.goto(`/plantoes?mes=${ym}`);
    await b.click("Novo plantão");
    await b.waitFor(`document.querySelector('#shift-type')`);
    check("tipo arquivado não aparece para novos plantões", !(await ev(`[...document.querySelector('#shift-type').options].some(o => o.textContent.includes(${JSON.stringify(h24)}))`)));
    await escape();
    check("plantões do tipo arquivado continuam no calendário", (await dots(d11)).some((l) => l.includes(h24)));

    // Isolamento
    await b.logout();
    await b.login(B);
    await b.goto(`/plantoes?mes=${ym}`);
    check("B não vê bolinhas de A", (await ev(`document.querySelectorAll('[data-shift-dot]').length`)) === 0);
    await b.goto("/plantoes/tipos");
    check("B não vê tipos de A", !(await bodyHas(P)));
    await b.logout();
    await b.login(A);
  }
  // -------------------------------------------------------------------------
  if (run("etapa11")) {
    t.info("— Etapa 11: recorrências, movimentações e trocas —");
    const weekdayOf = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
    const firstWeekday = (ymValue, wd) => {
      let d = `${ymValue}-01`;
      while (weekdayOf(d) !== wd) d = addDays(d, 1);
      return d;
    };
    const quinta = `${P} Quintas`;
    const alternado = `${P} Alternado`;
    check("criar tipo para recorrência semanal", await createType(quinta, { amount: "1.000,00", color: "Azul", start: "19:00", end: "07:00", nextDay: true }));
    check("criar tipo para semanas alternadas", await createType(alternado, { amount: "800,00", color: "Roxo" }));
    const m1 = addMonthsYm(ym, 1);
    const firstThu = firstWeekday(ym, 4);

    const newSeries = async (typeName, weekday, interval, start) => {
      await b.goto("/plantoes/recorrencias");
      await b.click("Nova recorrência");
      await b.waitFor(`document.querySelector('#series-type')`);
      await selectOption("#series-type", typeName);
      await ev(`document.querySelector('[data-weekday="${weekday}"]').click(); true`);
      await b.type("#series-interval", String(interval));
      await b.setValue("#series-start", start);
      await b.waitFor(`document.querySelector('[data-series-preview]')`);
      const preview = norm(await ev(`document.querySelector('[data-series-preview]').innerText`));
      await dialogSubmit();
      const ok = await b.waitFor(`!document.querySelector('[role=dialog]') && (document.querySelector('main [data-notice] p')?.textContent ?? '').startsWith('Recorrência criada')`, 30000);
      return { ok, preview };
    };
    const thu = await newSeries(quinta, 4, 1, `${ym}-01`);
    check("criar recorrência toda quinta (prévia descreve a regra)", thu.ok && thu.preview.includes("Toda quinta") && thu.preview.includes(`Próximas: ${br(firstThu)}`), thu.preview);
    const alt = await newSeries(alternado, 2, 2, `${ym}-01`);
    check("criar recorrência em semanas alternadas (terças)", alt.ok && alt.preview.includes("A cada 2 semanas: terça"), alt.preview);

    const typeDots = async (month, typeName) => {
      await b.goto(`/plantoes?mes=${month}`);
      return ev(`[...document.querySelectorAll('[data-shift-dot]')].filter(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${typeName} em`)})).map(d => d.closest('td').dataset.date)`);
    };
    const thursdays = await typeDots(ym, quinta);
    check("todas as quintas do mês têm bolinha", thursdays.length >= 4 && thursdays.every((d) => weekdayOf(d) === 4) && thursdays[0] === firstThu, thursdays);
    const tuesdays = [...(await typeDots(ym, alternado)), ...(await typeDots(m1, alternado))];
    check("semanas alternadas: terças a cada 14 dias, também no mês seguinte", tuesdays.length >= 3 && tuesdays.every((d, i) => i === 0 || (Date.parse(d) - Date.parse(tuesdays[i - 1])) / 86400000 === 14), tuesdays);
    const nextYearJan = `${Number(ym.slice(0, 4)) + 1}-01`;
    const jan = await typeDots(nextYearJan, quinta);
    check("virada de ano: quintas de janeiro seguinte", jan.length >= 4 && jan.every((d) => weekdayOf(d) === 4), jan);

    // Mês além do horizonte padrão: a tela pede a geração (operação explícita) e as bolinhas aparecem.
    const far = addMonthsYm(ym, 15);
    await b.goto(`/plantoes?mes=${far}`);
    check(
      "mês além do horizonte: geração disparada pela tela e bolinhas exibidas",
      await b.waitFor(`[...document.querySelectorAll('[data-shift-dot]')].some(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta} em`)}))`, 45000),
    );
    await b.goto(`/plantoes?mes=${addMonthsYm(ym, 125)}`);
    check("além do limite de segurança: aviso de período incompleto", await ev(`!!document.querySelector('[data-coverage-limit]')`));

    // Mover por formulário entre meses (troca individual).
    const lastThu = thursdays.at(-1);
    const target = addDays(lastThu, 5); // terça seguinte, no mês seguinte ou no mesmo
    await b.goto(`/plantoes?mes=${ym}`);
    await ev(`[...document.querySelectorAll('[data-day-dots="${lastThu}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta}`)})).click()`);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Mover", "[role=dialog]");
    await b.waitFor(`document.querySelector('#move-date')`);
    check("alcance padrão 'Somente este' para recorrente", await ev(`document.querySelector('[data-scope=este]').checked === true`));
    check("mesmo dia não permite confirmar", await ev(`[...document.querySelectorAll('[role=dialog] button[type=submit]')].find(x => x.textContent.includes('Confirmar movimentação')).disabled === true`));
    await b.setValue("#move-date", target);
    check("prévia mostra data antiga e nova", norm(await ev(`document.querySelector('[data-move-preview]').innerText`)).startsWith(`${br(lastThu)}`) && norm(await ev(`document.querySelector('[data-move-preview]').innerText`)).includes(br(target)));
    await b.type("#move-note", "Troca com colega fictício");
    await dialogSubmit();
    check("mover plantão (troca individual)", await waitNotice("Plantão movido. A data anterior ficou registrada no histórico."), await noticeText());
    const targetMonth = target.slice(0, 7);
    check("original não tem mais a bolinha", !(await typeDots(ym, quinta)).includes(lastThu));
    const inTarget = await typeDots(targetMonth, quinta);
    check("bolinha aparece na nova data (com contorno de troca)", inTarget.includes(target), inTarget);
    await ev(`[...document.querySelectorAll('[data-day-dots="${target}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').includes('movido')).click()`);
    await b.waitFor(`document.querySelector('[data-shift-history]')?.innerText.includes('Movido de')`, 20000);
    const det = norm(await details());
    check("detalhes: data original preservada e histórico da troca", det.includes(`data original ${br(lastThu)}`) && det.includes(`Movido de ${br(lastThu)} para ${br(target)} — Troca com colega fictício`), det);
    await escape();
    await b.goto(`/plantoes?mes=${ym}`);
    check("original não reaparece após nova geração/recarga", !(await typeDots(ym, quinta)).includes(lastThu));

    // Arraste com mouse: clique abre detalhes; arrastar abre a confirmação; cancelar não muda nada.
    const pick = thursdays[1];
    const sat = addDays(pick, 2);
    // Rola uma vez até a bolinha e lê as duas posições no mesmo instante (rolar de novo invalidaria a primeira).
    const pair = (dotSelector, targetSelector) =>
      ev(`(() => { const d = document.querySelector(${JSON.stringify(dotSelector)}); d.scrollIntoView({ block: 'center' });
        const a = d.getBoundingClientRect(); const b = document.querySelector(${JSON.stringify(targetSelector)}).getBoundingClientRect();
        return [{ x: a.left + a.width / 2, y: a.top + a.height / 2 }, { x: b.left + b.width / 2, y: b.top + b.height / 2 }]; })()`);
    const dotSel = `[data-day-dots="${pick}"] [data-shift-dot]`;
    const mouseDrag = async (from, to) => {
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, button: "left", buttons: 1 });
        await sleep(30);
      }
      await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
    };
    await b.goto(`/plantoes?mes=${ym}`);
    let [from] = await pair(dotSel, `td[data-date="${sat}"]`);
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x, y: from.y, button: "left", buttons: 0, clickCount: 1 });
    check("clique (sem arrastar) abre os detalhes, não a movimentação", (await b.waitFor(`document.querySelector('[data-shift-details]')`)) && !(await ev(`!!document.querySelector('#move-date')`)));
    await escape();
    let to;
    [from, to] = await pair(dotSel, `td[data-date="${sat}"]`);
    await mouseDrag(from, to);
    check("arrastar para outro dia abre a confirmação com as datas", (await b.waitFor(`document.querySelector('#move-date')?.value === ${JSON.stringify(sat)}`)) && norm(await ev(`document.querySelector('[data-move-preview]').innerText`)).includes(br(sat)));
    await b.click("Cancelar", "[role=dialog]");
    await sleep(500);
    check("cancelar o arraste restaura: bolinha continua no dia original", (await typeDots(ym, quinta)).includes(pick) && !(await typeDots(ym, quinta)).includes(sat));
    // Falha na gravação: o plantão é cancelado em outra sessão antes da confirmação → recusa e nada muda.
    [from, to] = await pair(dotSel, `td[data-date="${sat}"]`);
    await mouseDrag(from, to);
    await b.waitFor(`document.querySelector('#move-date')`);
    await asA((c) => c.query("update public.pl_shifts set status = 'cancelado' where type_id = (select id from public.pl_types where name = $1) and shift_date = $2::date", [quinta, pick]));
    await dialogSubmit();
    check("falha ao gravar: erro exibido, sem sucesso", await b.waitFor(`document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('não pode ser alterado')`, 20000));
    await escape();
    await asA((c) => c.query("update public.pl_shifts set status = 'agendado' where type_id = (select id from public.pl_types where name = $1) and shift_date = $2::date", [quinta, pick]));
    check("após a falha, a bolinha continua no dia original", (await typeDots(ym, quinta)).includes(pick) && !(await typeDots(ym, quinta)).includes(sat));
    [from, to] = await pair(dotSel, `td[data-date="${sat}"]`);
    await mouseDrag(from, to);
    await b.waitFor(`document.querySelector('#move-date')`);
    await dialogSubmit();
    check("arrastar e confirmar move o plantão", await waitNotice("Plantão movido. A data anterior ficou registrada no histórico."), await noticeText());
    check("bolinha no novo dia após arraste", (await typeDots(ym, quinta)).includes(sat));

    // Toque emulado: pressionar e segurar arrasta; deslizar rápido é rolagem (sem arraste).
    await b.viewport(375, 812);
    await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await b.goto(`/plantoes?mes=${ym}`);
    const touchPick = thursdays[2];
    const [tdot, tTarget] = await pair(`[data-day-dots="${touchPick}"] [data-shift-dot]`, `td[data-date="${addDays(touchPick, 1)}"]`);
    await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tdot.x, y: tdot.y }] });
    for (let i = 1; i <= 6; i++) await b.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tdot.x + i * 4, y: tdot.y + i * 12 }] });
    await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    check("toque: deslizar sem segurar não inicia arraste", !(await ev(`!!document.querySelector('#move-date')`)));
    await escape();
    const [tdot2, tTarget2] = await pair(`[data-day-dots="${touchPick}"] [data-shift-dot]`, `td[data-date="${addDays(touchPick, 1)}"]`);
    await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tdot2.x, y: tdot2.y }] });
    await sleep(600);
    for (let i = 1; i <= 8; i++) {
      await b.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tdot2.x + ((tTarget2.x - tdot2.x) * i) / 8, y: tdot2.y + ((tTarget2.y - tdot2.y) * i) / 8 }] });
      await sleep(30);
    }
    await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    check("toque: pressionar, segurar e arrastar abre a confirmação", await b.waitFor(`document.querySelector('#move-date')?.value === ${JSON.stringify(addDays(touchPick, 1))}`), { tTarget, tTarget2 });
    const fits = await ev(`(() => { const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 1; })()`);
    check("375px: confirmação da movimentação cabe na tela", fits);
    await escape();
    await b.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await b.viewport(1280, 900);

    // Excluir ocorrência recorrente: não é recriada.
    const delDay = thursdays[3];
    await b.goto(`/plantoes?mes=${ym}`);
    await ev(`[...document.querySelectorAll('[data-day-dots="${delDay}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta}`)})).click()`);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Excluir", "[role=dialog]");
    await b.waitFor(`document.querySelector('[role=alertdialog]')`);
    await b.click("Excluir", "[role=alertdialog]");
    check("excluir ocorrência recorrente", await waitNotice("Plantão excluído."), await noticeText());
    check("excluída não é recriada", !(await typeDots(ym, quinta)).includes(delDay));

    // Alterar recorrência a partir de uma ocorrência do mês seguinte (novo valor), com prévia.
    const m1Thursdays = await typeDots(m1, quinta);
    const pivot = m1Thursdays[1];
    await ev(`[...document.querySelectorAll('[data-day-dots="${pivot}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta}`)})).click()`);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Alterar recorrência a partir deste", "[role=dialog]");
    await b.waitFor(`document.querySelector('[data-series-impact]')`, 20000);
    const impact = norm(await ev(`document.querySelector('[data-series-impact]').innerText`));
    check("prévia da alteração com quantidade, período e preservados", /\d+ plantões gerados serão substituídos \(de /.test(impact) && impact.includes(br(pivot)), impact);
    await b.type("#series-amount", "1.100,00");
    await dialogSubmit();
    check("alterar recorrência a partir deste", await waitNotice("Recorrência atualizada a partir da data escolhida. Ocorrências preservadas ficaram como estavam."), await noticeText());
    const amountOn = async (date) => {
      await b.goto(`/plantoes?mes=${date.slice(0, 7)}`);
      await ev(`[...document.querySelectorAll('[data-day-dots="${date}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta}`)})).click()`);
      await b.waitFor(`document.querySelector('[data-shift-details]')`);
      const v = norm(await ev(`document.querySelector('[data-detail=amount]').innerText`));
      await escape();
      return v;
    };
    check("antes da data: valor antigo; a partir dela: novo valor", (await amountOn(m1Thursdays[0])).startsWith("R$ 1.000,00") && (await amountOn(pivot)).startsWith("R$ 1.100,00"), [m1Thursdays[0], pivot]);

    // Mover a série "este e os próximos": quinta → sexta.
    const m2 = addMonthsYm(ym, 2);
    const m2Thursdays = await typeDots(m2, quinta);
    const mv = m2Thursdays[0];
    await ev(`[...document.querySelectorAll('[data-day-dots="${mv}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${quinta}`)})).click()`);
    await b.waitFor(`document.querySelector('[data-shift-details]')`);
    await b.click("Mover", "[role=dialog]");
    await b.waitFor(`document.querySelector('#move-date')`);
    await b.setValue("#move-date", addDays(mv, 1));
    await ev(`document.querySelector('[data-scope=proximas]').click(); true`);
    check("prévia do alcance 'este e os próximos'", await b.waitFor(`/passa a cair 1 dia\\(s\\) depois/.test(document.querySelector('[data-move-impact]')?.innerText ?? '')`, 20000), await ev(`document.querySelector('[data-move-impact]')?.innerText`));
    await dialogSubmit();
    check("mover a recorrência a partir deste", await waitNotice("Recorrência movida a partir deste plantão. Ocorrências preservadas ficaram como estavam."), await noticeText());
    const m2After = await typeDots(m2, quinta);
    check("a partir dali, sextas em vez de quintas", m2After.length > 0 && m2After.every((d) => weekdayOf(d) === 5), m2After);

    // Arquivar tipo com recorrência: confirmação e suspensão; restaurar não retoma.
    await b.goto("/plantoes/tipos");
    await b.openMenu(`Ações: ${alternado}`);
    await b.menuItem("Arquivar");
    check("arquivar tipo com recorrência pede confirmação", await b.waitFor(`document.querySelector('[role=alertdialog]')?.innerText.includes('suspende novas gerações')`, 20000));
    await b.click("Arquivar e suspender", "[role=alertdialog]");
    check("arquivar e suspender", await waitNotice("Tipo arquivado. 1 recorrência suspensa."), await noticeText());
    await b.openMenu(`Ações: ${alternado}`);
    await b.menuItem("Restaurar");
    check("restaurar não retoma a recorrência", await waitNotice("Tipo restaurado. 1 recorrência continua suspensa até você retomar."), await noticeText());
    await b.goto("/plantoes/recorrencias");
    check("recorrência aparece como suspensa, com 'Retomar'", (await bodyHas("suspensa")) && (await ev(`[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Retomar')`)));

    for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
      await b.viewport(w, h);
      await b.goto("/plantoes/recorrencias");
      const m = await noOverflow();
      check(`${w}px /plantoes/recorrencias: sem rolagem horizontal`, !m.h && m.over === 0, m);
      await shot(`pl-recorrencias-${w}`);
    }
    await b.viewport(1280, 900);

    await b.logout();
    await b.login(B);
    await b.goto("/plantoes/recorrencias");
    check("B não vê recorrências de A", !(await bodyHas(P)));
    await b.logout();
    await b.login(A);
  }
  // -------------------------------------------------------------------------
  if (run("etapa12")) {
    t.info("— Etapa 12: valores e recebimentos —");
    const ref = `${P} Referência`;
    check("criar tipo do cenário de referência", await createType(ref, { amount: "1.000,00", color: "Laranja" }));
    const M = addMonthsYm(ym, -2);
    const M1 = addMonthsYm(ym, -1);
    const dA = `${M}-05`;
    const dB = `${M}-12`;
    const dC = `${M}-19`;
    const dD = `${M}-26`;
    const addWith = async (date, amount) => {
      await openDay(date, ref);
      await b.type("#shift-amount", amount);
      await dialogSubmit();
      return waitNotice("Plantão adicionado.");
    };
    check("adicionar A (R$ 1.000), B (R$ 800), C (R$ 500), D (R$ 700)", (await addWith(dA, "1.000,00")) && (await addWith(dB, "800,00")) && (await addWith(dC, "500,00")) && (await addWith(dD, "700,00")));
    const openRef = async (date) => {
      await b.goto(`/plantoes?mes=${date.slice(0, 7)}`);
      await ev(`[...document.querySelectorAll('[data-day-dots="${date}"] [data-shift-dot]')].find(d => d.getAttribute('aria-label').startsWith(${JSON.stringify(`Plantão ${ref}`)})).click()`);
      await b.waitFor(`document.querySelector('[data-shift-details]')`);
    };
    const confirmIn = async (label) => {
      await b.waitFor(`document.querySelector('[role=alertdialog]')`);
      await b.click(label, "[role=alertdialog]");
    };
    await openRef(dA);
    check("data passada continua agendada (a confirmar) até marcar", norm(await ev(`document.querySelector('[data-detail=status]').innerText`)).includes("a confirmar"));
    await b.click("Marcar realizado", "[role=dialog]");
    await confirmIn("Marcar realizado");
    check("marcar A como realizado (manual)", await waitNotice("Plantão marcado como realizado."), await noticeText());
    await openRef(dA);
    await b.click("Registrar recebimento", "[role=dialog]");
    await b.waitFor(`document.querySelector('#receive-date')`);
    check("data do recebimento limitada a hoje", (await ev(`document.querySelector('#receive-date').max`)) === today);
    await b.setValue("#receive-date", addDays(today, 1));
    await dialogSubmit();
    check("recebimento com data futura é recusado", await b.waitFor(`(document.getElementById('receive-date-erro')?.textContent ?? '').includes('não pode ser futura')`, 20000));
    await b.setValue("#receive-date", `${M1}-10`);
    await dialogSubmit();
    check("registrar recebimento de A no mês seguinte", await waitNotice("Recebimento registrado (valor integral do plantão)."), await noticeText());
    await openRef(dB);
    await b.click("Marcar realizado", "[role=dialog]");
    await confirmIn("Marcar realizado");
    check("marcar B como realizado", await waitNotice("Plantão marcado como realizado."), await noticeText());
    await openRef(dD);
    await b.click("Cancelar plantão", "[role=dialog]");
    await confirmIn("Cancelar plantão");
    check("cancelar D", await waitNotice("Plantão cancelado. Ele continua no histórico e no filtro de cancelados."), await noticeText());

    const totals = async () =>
      ev(`Object.fromEntries([...document.querySelectorAll('[data-totals] [data-total]')].map(el => [el.dataset.total, (el.querySelector('dd')?.textContent ?? el.textContent).replace(/\\u00a0/g, ' ').trim()]))`);
    await b.goto(`/plantoes?mes=${M}`);
    const tt = await totals();
    check(
      "totais do mês: Programado 2.300; Recebido 1.000; A receber 1.300 (sem indicadores extras)",
      tt.programado === "R$ 2.300,00" && tt["recebido-do-mes"] === "R$ 1.000,00" && tt["a-receber"] === "R$ 1.300,00" && Object.keys(tt).length === 3,
      tt,
    );
    check("resumo enxuto: sem 'Realizado (indicador)' nem textos explicativos", !(await bodyHas("Realizado (indicador)")) && !(await bodyHas("não são um total bruto")));
    const inMonth = () => ev(`(document.querySelector('[data-received-in-month] span')?.textContent ?? '').replace(/\\u00a0/g, ' ')`);
    check("mês sem recebimento (pela data do recebimento) não mostra a linha 'Entrou neste mês'", (await inMonth()) === "", await inMonth());
    await b.goto(`/plantoes?mes=${M1}`);
    check("recebido no mês seguinte: R$ 1.000,00", (await inMonth()).startsWith("R$ 1.000,00"), await inMonth());

    // Filtros e "a confirmar".
    await b.goto(`/plantoes?mes=${M}&pagamento=recebido`);
    const recDots = await ev(`[...document.querySelectorAll('[data-shift-dot]')].map(d => d.closest('td').dataset.date)`);
    check("filtro 'Recebidos': só A, e totais do recorte (R$ 1.000,00)", JSON.stringify(recDots) === JSON.stringify([dA]) && (await totals()).programado === "R$ 1.000,00", recDots);
    await b.goto(`/plantoes?mes=${M}&situacao=a-confirmar`);
    const confDots = await ev(`[...document.querySelectorAll('[data-shift-dot]')].map(d => d.closest('td').dataset.date)`);
    check("filtro 'A confirmar': só C (passado agendado)", JSON.stringify(confDots) === JSON.stringify([dC]), confDots);
    check("lista 'A confirmar' fora da grade inclui C", norm(await ev(`document.querySelector('[data-to-confirm]')?.innerText`)).includes(`${ref} · ${br(dC)}`));
    await b.goto(`/plantoes?mes=${M}&situacao=cancelado&cancelados=1`);
    check("filtro 'Cancelados' mostra D; totais excluem cancelados", (await ev(`[...document.querySelectorAll('[data-shift-dot]')].map(d => d.closest('td').dataset.date)`)).join() === dD && (await totals()).programado === "R$ 0,00");

    // Proteções e desfazer recebimento.
    await openRef(dA);
    check("recebido: sem 'Cancelar' e com explicação", !(await ev(`[...document.querySelectorAll('[role=dialog] button')].some(x => x.textContent.includes('Cancelar plantão'))`)) && norm(await ev(`document.querySelector('[data-locks]')?.textContent`)).includes("desfaça o recebimento"));
    await b.click("Editar", "[role=dialog]");
    await b.waitFor(`document.querySelector('#shift-amount')`);
    await b.type("#shift-amount", "1.100,00");
    await dialogSubmit();
    check("alterar valor recebido é recusado com orientação", await b.waitFor(`(document.querySelector('[role=dialog] [role=alert]')?.textContent ?? '').includes('desfaça o recebimento')`, 20000));
    await escape();
    await openRef(dA);
    await b.click("Desfazer recebimento", "[role=dialog]");
    await confirmIn("Desfazer recebimento");
    check("desfazer recebimento (com confirmação)", await waitNotice("Recebimento desfeito. O registro anterior ficou no histórico."), await noticeText());
    await b.goto(`/plantoes?mes=${M}`);
    const t2 = await totals();
    check("após desfazer: Recebido dos plantões 0; A receber 2.300", t2["recebido-do-mes"] === "R$ 0,00" && t2["a-receber"] === "R$ 2.300,00", t2);
    await openRef(dA);
    check("histórico preserva o recebimento anterior", await b.waitFor(`(document.querySelector('[data-shift-history]')?.innerText ?? '').includes('Recebimento desfeito (estava registrado em ${br(`${M1}-10`)}')`, 20000));
    await escape();

    // Recebimento antecipado de plantão futuro: não marca realização.
    const futureDay = addDays(today, 5);
    await addWith(futureDay, "600,00");
    await openRef(futureDay);
    await b.click("Registrar recebimento", "[role=dialog]");
    await b.waitFor(`document.querySelector('#receive-date')`);
    await dialogSubmit();
    check("recebimento antecipado", await waitNotice("Recebimento registrado (valor integral do plantão)."), await noticeText());
    await openRef(futureDay);
    const fd = norm(await details());
    check("antecipado continua 'Agendado' e aparece como recebido", fd.includes("Situação Agendado") && fd.includes(`Data em que recebi ${br(today)}`) && fd.includes("R$ 600,00"), fd);
    await escape();

    for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
      await b.viewport(w, h);
      await b.goto(`/plantoes?mes=${M}`);
      const m = await noOverflow();
      check(`${w}px calendário com filtros e totais: sem rolagem horizontal`, !m.h && m.over === 0, m);
      await shot(`pl-totais-${w}`);
    }
    await b.viewport(1280, 900);

    await b.logout();
    await b.login(B);
    await b.goto(`/plantoes?mes=${M}`);
    check("B: mês vazio sem resumo zerado e nada de A", !(await ev(`!!document.querySelector('[data-totals]')`)) && !(await bodyHas(P)));
    await b.goto(`/plantoes?mes=${M1}`);
    check("B: recebido no mês não inclui A", (await inMonth()) === "" && !(await bodyHas("R$ 1.000,00")));
    await b.logout();
    await b.login(A);
  }
} catch (error) {
  check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  const removed = await cleanup().catch((e) => `falhou (${e.code ?? e.message})`);
  t.info(`limpeza final: ${removed} registro(s) de teste removidos`);
  t.print();
  console.log(`\nconsole: ${b.consoleIssues.length ? `${b.consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(t.failures ? `${t.failures} falha(s).` : "Todos os fluxos passaram.");
  await b.close();
}
process.exit(t.failures ? 1 : 0);
