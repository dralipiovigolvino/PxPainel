import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupCnpjs, cleanupPericias, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import { estimateTax } from "@/lib/tax";
import { createCnpj, updateCnpj } from "@/modules/cnpj/data";
import { monthRange } from "@/modules/financas/domain/filters";
import {
  createCompany,
  createExam,
  deleteCompany,
  deleteExam,
  getExamEvents,
  listCompanies,
  listExams,
  receiveExam,
  setCompanyArchived,
  setExamCanceled,
  setExamDone,
  undoExamReceipt,
  updateCompany,
  updateExam,
} from "./data";
import { companySchema, examSchema } from "./domain/schemas";
import { examTotals } from "./domain/totals";

/** Perícias, "recebo por CNPJ" e imposto estimado no Neon real (contas fictícias A e B). */
const { A, B } = testUsers();
const companies: string[] = [];
const cnpjs: string[] = [];
const today = todayInSaoPaulo();
/** CNPJ fictício da conta A, a 9%. */
let CNPJ = "";

async function newCnpj(name: string, taxRate = 900) {
  // A abreviação também é única por usuário. Inclua parte do identificador da
  // execução para que uma suíte interrompida não invalide a execução seguinte.
  const runSuffix = TAG.replace(/\D/g, "").slice(-6);
  const abbreviation = `${name.slice(0, 13)} ${runSuffix}`.trim().slice(0, 20);
  const r = await createCnpj(A, { name: `${TAG} ${name}`, abbreviation, number: null, taxRate, taxDueDay: 20 });
  const id = (r as { id: string }).id;
  cnpjs.push(id);
  return id;
}

beforeAll(async () => {
  CNPJ = await newCnpj("CNPJ perícias");
});
afterAll(async () => {
  await cleanupPericias(companies);
  await cleanupCnpjs(cnpjs);
});

/** `cnpjId`: "" = sem CNPJ (padrão destes testes: por CNPJ, como era antes do cadastro). */
async function newCompany(name: string, amount: string, user = A, cnpjId = user === A ? CNPJ : "") {
  const r = await createCompany(user, companySchema.parse({ name: `${TAG} ${name}`, amount, cnpjId }));
  const id = (r as { id: string }).id;
  companies.push(id);
  return id;
}
const examInput = (companyId: string, date: string, time: string, amount: string, cnpjId = CNPJ) => examSchema.parse({ companyId, date, time, amount, cnpjId, notes: "" });
async function add(companyId: string, date: string, time: string, amount: string, user = A, cnpjId = user === A ? CNPJ : "") {
  const r = await createExam(user, { ...examInput(companyId, date, time, amount, cnpjId), requestId: randomUUID() });
  return (r as { id: string }).id;
}
const find = async (id: string, date: string, user = A) => (await listExams(user, date, date)).find((e) => e.id === id);

describe("Perícias, recebo por CNPJ e imposto estimado (Neon real)", () => {
  it("por CNPJ: o percentual do CNPJ fica gravado na perícia; sem CNPJ, nenhum imposto", async () => {
    const company = await newCompany("Empresa Alíquota", "1.000,00");
    expect((await listCompanies(A)).find((c) => c.id === company)?.cnpjId).toBe(CNPJ);
    const date = addDays(today, 40);
    const byCnpj = await add(company, date, "09:00", "1.000,00");
    expect(await find(byCnpj, date)).toMatchObject({ amountCents: 100000, cnpjId: CNPJ, taxRateBp: 900, status: "agendada", receivedOn: null });
    expect(estimateTax(100000, 900)).toEqual({ taxCents: 9000, netCents: 91000 });
    expect((await getExamEvents(A, byCnpj))[0].details).toMatchObject({ cnpj: true, aliquota_bp: 900 });
    // Desmarcada só nesta perícia: sem CNPJ, alíquota zero.
    const plain = await add(company, date, "10:00", "1.000,00", A, "");
    expect(await find(plain, date)).toMatchObject({ cnpjId: null, taxRateBp: 0 });
    expect((await getExamEvents(A, plain))[0].details).toMatchObject({ cnpj: false, aliquota_bp: 0 });

    // Editar no mesmo CNPJ não recalcula a alíquota gravada, mesmo que o percentual do CNPJ mude depois.
    const other = await newCnpj("CNPJ de outro percentual", 1500);
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00"))).toMatchObject({ ok: true });
    expect(await find(byCnpj, date)).toMatchObject({ amountCents: 120000, cnpjId: CNPJ, taxRateBp: 900, time: "10:30" });
    // Trocar de CNPJ usa o percentual do novo; desmarcar zera; marcar de novo usa o percentual atual.
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00", other))).toMatchObject({ ok: true });
    expect(await find(byCnpj, date)).toMatchObject({ cnpjId: other, taxRateBp: 1500 });
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00", ""))).toMatchObject({ ok: true });
    expect(await find(byCnpj, date)).toMatchObject({ cnpjId: null, taxRateBp: 0 });
    expect((await getExamEvents(A, byCnpj)).at(-1)?.details).toMatchObject({ cnpj: { de: true, para: false }, aliquota_bp: 0 });
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00"))).toMatchObject({ ok: true });
    expect(await find(byCnpj, date)).toMatchObject({ cnpjId: CNPJ, taxRateBp: 900 });
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00"))).toEqual({ ok: false, reason: "nothing_to_do" });
    // CNPJ inexistente não é aceito.
    expect(await updateExam(A, byCnpj, examInput(company, date, "10:30", "1.200,00", randomUUID()))).toEqual({ ok: false, reason: "cnpj_not_found" });
    expect(await createExam(A, { ...examInput(company, date, "11:00", "1,00", randomUUID()), requestId: randomUUID() })).toEqual({ ok: false, reason: "cnpj_not_found" });
    // O percentual de um CNPJ muda só as perícias dele do mês corrente em diante (a perícia acima é de outro CNPJ).
    expect(await updateCnpj(A, other, { name: `${TAG} CNPJ de outro percentual`, abbreviation: "Outro", number: null, taxRate: 1600, taxDueDay: 20 })).toMatchObject({ ok: true, applied: { exams: 0, shifts: 0 } });
    expect((await find(byCnpj, date))?.taxRateBp).toBe(900);
  });

  it("perícia recebida: o valor continua travado, mas a marcação de CNPJ pode ser corrigida", async () => {
    const company = await newCompany("Empresa Recebida", "1.000,00");
    const date = addDays(today, -4);
    const id = await add(company, date, "09:00", "1.000,00");
    expect(await receiveExam(A, id, today)).toMatchObject({ ok: true });
    expect(await updateExam(A, id, examInput(company, date, "09:00", "900,00"))).toEqual({ ok: false, reason: "received" });
    expect(await updateExam(A, id, examInput(company, date, "09:00", "1.000,00", ""))).toMatchObject({ ok: true });
    expect(await find(id, date)).toMatchObject({ cnpjId: null, taxRateBp: 0, receivedOn: today, amountCents: 100000 });
    expect(await updateExam(A, id, examInput(company, date, "09:00", "1.000,00"))).toMatchObject({ ok: true });
    expect(await find(id, date)).toMatchObject({ cnpjId: CNPJ, taxRateBp: 900, receivedOn: today });
  });

  it("valor herdado da empresa; mudar o padrão não altera perícias existentes; nome duplicado recusado", async () => {
    const company = await newCompany("Empresa Padrão", "850,50");
    const [c] = (await listCompanies(A)).filter((x) => x.id === company);
    expect(c).toMatchObject({ defaultAmountCents: 85050, archived: false, links: 0 });
    // O formulário copia o padrão da empresa para o valor da perícia.
    const exam = await add(company, addDays(today, 5), "14:00", "850,50");
    // Mudar o padrão (valor e marcação de CNPJ) vale para as próximas: a perícia já cadastrada fica como estava.
    expect(await updateCompany(A, company, companySchema.parse({ name: `${TAG} Empresa Padrão`, amount: "990,00", cnpjId: "" }))).toMatchObject({ ok: true });
    expect((await listCompanies(A)).find((x) => x.id === company)).toMatchObject({ defaultAmountCents: 99000, cnpjId: null, links: 1 });
    expect(await find(exam, addDays(today, 5))).toMatchObject({ amountCents: 85050, cnpjId: CNPJ, taxRateBp: 900 });
    expect(await createCompany(A, companySchema.parse({ name: `${TAG} empresa padrão`, amount: "1,00", cnpjId: "" }))).toEqual({ ok: false, reason: "duplicate_name" });
    expect(await updateCompany(A, company, companySchema.parse({ name: `${TAG} Empresa Padrão`, amount: "990,00", cnpjId: randomUUID() }))).toEqual({ ok: false, reason: "cnpj_not_found" });
    // Com perícias: não exclui; arquiva. Arquivada não recebe perícia nova.
    expect(await deleteCompany(A, company)).toEqual({ ok: false, reason: "has_links" });
    expect(await setCompanyArchived(A, company, true)).toMatchObject({ ok: true });
    expect(await createExam(A, { ...examInput(company, today, "08:00", "1,00"), requestId: randomUUID() })).toEqual({ ok: false, reason: "company_archived" });
    expect(await setCompanyArchived(A, company, false)).toMatchObject({ ok: true });
    const empty = await newCompany("Empresa Vazia", "10,00");
    expect(await deleteCompany(A, empty)).toEqual({ ok: true });
  });

  it("envio duplicado do formulário cria uma só perícia", async () => {
    const company = await newCompany("Empresa Idempotente", "500,00");
    const input = { ...examInput(company, addDays(today, 6), "08:00", "500,00"), requestId: randomUUID() };
    const [r1, r2] = await Promise.all([createExam(A, input), createExam(A, input)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect((await listExams(A, addDays(today, 6), addDays(today, 6))).filter((e) => e.companyId === company)).toHaveLength(1);
  });

  it("situação e recebimento são independentes; canceladas fora dos totais; histórico em ordem", async () => {
    const company = await newCompany("Empresa Fluxo", "1.000,00");
    const past = addDays(today, -2);
    const done = await add(company, past, "09:00", "1.000,00");
    const scheduled = await add(company, past, "11:00", "600,00");
    const canceled = await add(company, past, "13:00", "400,00");

    // Data passada não realiza sozinha.
    expect((await find(done, past))?.status).toBe("agendada");
    // Recebimento antecipado não marca realização.
    expect(await receiveExam(A, scheduled, addDays(today, 1))).toEqual({ ok: false, reason: "receipt_future" });
    expect(await receiveExam(A, scheduled, today)).toMatchObject({ ok: true });
    expect(await find(scheduled, past)).toMatchObject({ status: "agendada", receivedOn: today });
    // Com recebimento: valor travado e não cancela.
    expect(await updateExam(A, scheduled, examInput(company, past, "11:00", "700,00"))).toEqual({ ok: false, reason: "received" });
    expect(await setExamCanceled(A, scheduled, true)).toEqual({ ok: false, reason: "received" });
    expect(await undoExamReceipt(A, scheduled)).toMatchObject({ ok: true });

    expect(await setExamDone(A, done, true)).toMatchObject({ ok: true });
    expect(await find(done, past)).toMatchObject({ status: "realizada", receivedOn: null });
    expect(await setExamCanceled(A, done, true)).toMatchObject({ ok: false, reason: "locked" });
    expect(await deleteExam(A, done)).toEqual({ ok: false, reason: "locked" });
    expect(await setExamCanceled(A, canceled, true)).toMatchObject({ ok: true });

    // Uma perícia sem CNPJ no mesmo dia: entra no valor, sem imposto estimado.
    await add(company, past, "15:00", "200,00", A, "");
    const month = (await listExams(A, past, past)).filter((e) => e.companyId === company);
    const t = examTotals(month);
    // Calculado à mão (9% só no que é por CNPJ): agendadas 600,00 → 54,00 e 200,00 sem CNPJ → 0; realizada 1.000,00 → 90,00.
    expect(t.agendadas).toEqual({ count: 2, gross: 80000n, tax: 5400n, net: 74600n });
    expect(t.realizadas).toEqual({ count: 1, gross: 100000n, tax: 9000n, net: 91000n });
    expect(t.total).toEqual({ count: 3, gross: 180000n, tax: 14400n, net: 165600n });
    expect(t.canceledCount).toBe(1);

    expect((await getExamEvents(A, scheduled)).map((e) => e.action)).toEqual(["criada", "recebida", "recebimento_desfeito"]);
    expect(await setExamDone(A, done, false)).toMatchObject({ ok: true });
    expect((await getExamEvents(A, done)).map((e) => e.action)).toEqual(["criada", "realizada", "realizacao_desfeita"]);
    expect(await deleteExam(A, scheduled)).toEqual({ ok: true });
  });

  it("isolamento: B não vê nem usa empresas e perícias de A", async () => {
    const company = await newCompany("Empresa Isolada", "300,00");
    const exam = await add(company, addDays(today, 7), "09:00", "300,00");
    const { from, to } = monthRange({ year: Number(addDays(today, 7).slice(0, 4)), month: Number(addDays(today, 7).slice(5, 7)) });
    expect((await listCompanies(B)).some((c) => c.id === company)).toBe(false);
    expect((await listExams(B, from, to)).some((e) => e.id === exam)).toBe(false);
    expect(await getExamEvents(B, exam)).toEqual([]);
    // B não cria perícia na empresa de A (chave estrangeira composta com o usuário) nem altera a de A.
    expect(await createExam(B, { ...examInput(company, today, "08:00", "1,00", ""), requestId: randomUUID() })).toEqual({ ok: false, reason: "not_found" });
    // B não marca uma perícia sua com o CNPJ de A (nem pelo app nem direto no banco).
    const companyB = await newCompany("Empresa de B", "100,00", B);
    expect(await createExam(B, { ...examInput(companyB, today, "08:00", "1,00", CNPJ), requestId: randomUUID() })).toEqual({ ok: false, reason: "cnpj_not_found" });
    await expect(asUser(B.id, "insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, current_date, '08:00', 100, 900, $3)", [B.id, companyB, CNPJ])).rejects.toMatchObject({ code: "23503" });
    await expect(asUser(B.id, "update public.per_companies set cnpj_id = $2 where id = $1", [companyB, CNPJ])).rejects.toMatchObject({ code: "23503" });
    // O banco não aceita alíquota em perícia sem CNPJ.
    await expect(asUser(A.id, "update public.per_exams set cnpj_id = null where id = $1", [exam])).rejects.toMatchObject({ code: "23514" });
    expect(await setExamDone(B, exam, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await receiveExam(B, exam, today)).toEqual({ ok: false, reason: "not_found" });
    expect(await updateCompany(B, company, companySchema.parse({ name: "x", amount: "1,00", cnpjId: "" }))).toEqual({ ok: false, reason: "not_found" });
    // No banco, com o papel do app: sem contexto nada aparece; B não grava linha em nome de A.
    expect(await asUser(null, "select id from public.per_exams")).toEqual([]);
    expect(await asUser(B.id, "select id from public.per_companies where id = $1", [company])).toEqual([]);
    await expect(asUser(B.id, "insert into public.per_companies (user_id, name, default_amount_cents) values ($1, 'x', 100)", [A.id])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(A.id, "update public.per_exams set user_id = $1 where id = $2", [B.id, exam])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(A.id, "update public.per_exams set done_at = now() where id = $1", [exam])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(A.id, "delete from public.per_events where exam_id = $1", [exam])).rejects.toMatchObject({ code: "42501" });
    expect((await find(exam, addDays(today, 7)))?.status).toBe("agendada");
  });
});
