import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCnpjs, cleanupFollowup, cleanupPericias, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { createCnpj } from "@/modules/cnpj/data";
import { scheduleAppointment } from "@/modules/followup/appointments-data";
import { followupDashboard } from "@/modules/followup/dashboard";
import { createPatient, createTemplate } from "@/modules/followup/data";
import { patientSchema, templateSchema } from "@/modules/followup/domain/schemas";
import { createConsultationWithPlan } from "@/modules/followup/plans-data";
import { periciasDashboard } from "@/modules/pericias/dashboard";
import { createCompany, createExam, setExamCanceled, setExamDone } from "@/modules/pericias/data";
import { companySchema, examSchema } from "@/modules/pericias/domain/schemas";
import { plantoesDashboard } from "@/modules/plantoes/dashboard";
import { createShift, createType, receiveShift } from "@/modules/plantoes/data";
import { expectedPayDate } from "@/modules/plantoes/domain/payment";
import { shiftSchema, typeSchema } from "@/modules/plantoes/domain/schemas";
import { buildSections, describeSummary } from "./aggregate";

/** Bloco 6 no Neon real: Perícias, avisos de término e previsão de pagamento no Dashboard. Dados fictícios. */
const { A, B } = testUsers();
const today = todayInSaoPaulo();
const NOW = 600; // 10:00 em São Paulo
const companies: string[] = [];
const patients: string[] = [];
const templates: string[] = [];
const types: string[] = [];
const cnpjs: string[] = [];
/** CNPJ fictício da conta A, a 9%. */
let CNPJ = "";

beforeAll(async () => {
  CNPJ = ((await createCnpj(A, { name: `${TAG} Dash CNPJ`, abbreviation: "Dash", number: null, taxRate: 900, taxDueDay: 20 })) as { id: string }).id;
  cnpjs.push(CNPJ);
});
afterAll(async () => {
  await cleanupPericias(companies);
  await cleanupFollowup(patients, templates);
  await cleanupPlantoes(types);
  await cleanupCnpjs(cnpjs);
});

describe("Dashboard: novos itens (Neon real)", () => {
  it("perícias: hoje, próximas e a confirmar; canceladas, realizadas e além de 7 dias ficam fora; resumo do mês", async () => {
    const company = (await createCompany(A, companySchema.parse({ name: `${TAG} Dash Empresa`, amount: "1.000,00", cnpjId: "" }))) as { id: string };
    companies.push(company.id);
    const add = async (date: string, time: string, cnpjId = "") =>
      ((await createExam(A, { ...examSchema.parse({ companyId: company.id, date, time, amount: "1.000,00", cnpjId, notes: "" }), requestId: randomUUID() })) as { id: string }).id;
    const later = await add(today, "15:00"); // hoje, ainda não aconteceu
    const earlier = await add(today, "08:00"); // hoje, horário já passou → a confirmar
    const past = await add(addDays(today, -3), "09:00"); // a confirmar
    const soon = await add(addDays(today, 7), "09:00"); // último dia dos próximos 7
    const far = await add(addDays(today, 8), "09:00"); // fora
    const canceled = await add(addDays(today, 1), "09:00");
    await setExamCanceled(A, canceled, true);
    const done = await add(addDays(today, -1), "09:00");
    await setExamDone(A, done, true);

    const { data, summary } = await periciasDashboard(A, today, NOW);
    const mine = (id: string) => data.items.find((i) => i.id === id);
    expect(mine(later)).toMatchObject({ section: "hoje", status: "hoje", source: "pericias", type: "pericia", kind: "compromisso", detail: "Perícia às 15:00", amount: { kind: "none" } });
    expect(mine(earlier)).toMatchObject({ section: "a_confirmar", status: "a_confirmar" });
    expect(mine(past)).toMatchObject({ section: "a_confirmar", status: "a_confirmar" });
    expect(mine(soon)).toMatchObject({ section: "proximos", status: "proximo" });
    expect(mine(far)).toBeUndefined();
    expect(mine(canceled)).toBeUndefined();
    expect(mine(done)).toBeUndefined();
    // O link abre o registro no mês certo.
    expect(mine(past)?.href).toBe(`/pericias?mes=${addDays(today, -3).slice(0, 7)}&pericia=${past}`);
    // Resumo: só valores formatados; nunca entra em "pagamentos". Sem perícia por CNPJ no mês, não há imposto a mostrar.
    expect(summary.agendadas.count).toBeGreaterThanOrEqual(1);
    expect(summary.hasTax).toBe(false);
    await add(today, "16:00", CNPJ);
    expect((await periciasDashboard(A, today, NOW)).summary.hasTax).toBe(true);
    const { sections } = buildSections([{ ok: true, data }]);
    const hoje = sections.find((s) => s.section === "hoje")!;
    expect(hoje.summary.payments.count).toBe(0);
    expect(describeSummary({ ...hoje.summary, exams: 1 }, formatCents)).toBeNull(); // perícia nunca vira valor a pagar
    // B não vê nada de A.
    expect((await periciasDashboard(B, today, NOW)).data.items.some((i) => [later, earlier, past, soon].includes(i.id))).toBe(false);
  });

  it("acompanhamentos: aviso perto do fim, no último dia e encerrado; mostra a próxima consulta; sem dados clínicos", async () => {
    const tpl = (await createTemplate(A, templateSchema.parse({ name: `${TAG} Dash Prazo`, description: "", steps: JSON.stringify([{ dayOffset: 1, message: "Mensagem fictícia sigilosa" }]), durationDays: "10", noticeDays: "3" }))) as { id: string };
    templates.push(tpl.id);
    const patient = async (name: string) => {
      const r = (await createPatient(A, patientSchema.parse({ name: `${TAG} ${name}`, phone: "11987654321", notes: "Observação clínica fictícia" }))) as { id: string };
      patients.push(r.id);
      return r.id;
    };
    const consult = async (patientId: string, daysAgo: number) => {
      const r = await createConsultationWithPlan(A, patientId, { consultDate: addDays(today, -daysAgo), notes: null, requestId: randomUUID(), templateId: tpl.id });
      expect(r.ok).toBe(true);
    };
    const running = await patient("Dash Em curso");
    await consult(running, 2); // faltam 8: fora do aviso
    const near = await patient("Dash Perto");
    await consult(near, 8); // faltam 2: perto de encerrar, sem próxima consulta
    const nearScheduled = await patient("Dash Perto agendado");
    await consult(nearScheduled, 8);
    expect(await scheduleAppointment(A, nearScheduled, { date: addDays(today, 5), time: "14:30", requestId: randomUUID() })).toMatchObject({ ok: true });
    const last = await patient("Dash Último dia");
    await consult(last, 10); // termina hoje
    const ended = await patient("Dash Encerrado");
    await consult(ended, 20); // encerrado há 10 dias, sem próxima consulta

    const data = await followupDashboard(A, today);
    const notice = (name: string) => data.items.find((i) => i.kind === "aviso" && i.title === `${TAG} ${name}`);
    expect(notice("Dash Em curso")).toBeUndefined();
    expect(notice("Dash Perto")).toMatchObject({ section: "prazos", status: "perto_de_encerrar", attention: true, type: "prazo", date: addDays(today, 2) });
    expect(notice("Dash Perto")?.detail).toContain("faltam 2 dias");
    expect(notice("Dash Perto")?.detail).toContain("Próxima consulta não agendada");
    expect(notice("Dash Perto agendado")).toMatchObject({ status: "perto_de_encerrar", attention: false });
    expect(notice("Dash Perto agendado")?.detail).toMatch(/Próxima consulta: \d{2}\/\d{2}\/\d{4} às 14:30/);
    expect(notice("Dash Último dia")).toMatchObject({ status: "termina_hoje", attention: true });
    expect(notice("Dash Encerrado")).toMatchObject({ status: "encerrado", attention: true });
    expect(notice("Dash Encerrado")?.detail).toContain("há 10 dias");
    // O aviso leva só nome, prazo e datas: nada de telefone, observação ou mensagem.
    const text = JSON.stringify(data.items.filter((i) => i.kind === "aviso"));
    expect(text).not.toMatch(/987654321|Observação clínica|Mensagem fictícia/);
    // O fim do prazo não mexeu nas etapas: a etapa D1 atrasada continua na lista de pendências.
    expect(data.items.some((i) => i.type === "etapa" && i.title === `${TAG} Dash Encerrado` && i.section === "atrasados")).toBe(true);
    const { sections } = buildSections([{ ok: true, data }]);
    const prazos = sections.find((s) => s.section === "prazos")!;
    expect(prazos.summary.notices).toBeGreaterThanOrEqual(4);
    expect(prazos.summary.attention).toBeGreaterThanOrEqual(3);
    expect((await followupDashboard(B, today)).items.some((i) => i.title.includes("Dash "))).toBe(false);
  });

  it("plantões: item da agenda sem informação financeira; previsões seguem agrupadas fora do item", async () => {
    const type = (await createType(A, typeSchema.parse({ name: `${TAG} Dash Previsão`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payDay: "20" }))) as { id: string };
    types.push(type.id);
    const add = async (date: string, extra: Record<string, string> = {}) =>
      (
        (await createShift(A, type.id, {
          ...shiftSchema.parse({ date, amount: "1.000,00", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payMode: "auto", payDate: "", ...extra }),
          requestId: randomUUID(),
          confirmOverlap: true,
        })) as { id: string }
      ).id;
    const a = await add(today);
    const b = await add(addDays(today, 1), { cnpjId: "", amount: "800,00" });
    const overdue = await add(addDays(today, -70)); // previsão já vencida
    const paid = await add(addDays(today, -130)); // recebido: não pode aparecer como previsão
    await receiveShift(A, paid, today);

    const { data, summary } = await plantoesDashboard(A, today, NOW);
    const item = data.items.find((i) => i.id === a)!;
    const plain = (v: string | null | undefined) => (v ?? "").replace(new RegExp(String.fromCharCode(160), "g"), " ");
    expect(plain(item.detail)).toBe("Sem horário definido");
    expect(plain(item.detail)).not.toMatch(/R\$|bruto|líquido|pagamento/);
    expect(item.amount).toEqual({ kind: "none" }); // não entra em despesas a pagar
    expect(plain(data.items.find((i) => i.id === b)?.detail)).toBe("Sem horário definido");
    // Previsão vencida sem recebimento, separada; o recebido não aparece como previsão.
    const dueOverdue = expectedPayDate(addDays(today, -70), 20);
    expect(summary.forecast.overdue.find((r) => r.date === dueOverdue)).toMatchObject({ overdue: true });
    const all = [...summary.forecast.overdue, ...summary.forecast.next];
    const total = all.reduce((n, r) => n + r.count, 0);
    expect(total).toBeGreaterThanOrEqual(2);
    // Mesmo dia de pagamento para os plantões do mesmo mês: aparecem no mesmo grupo.
    if (today.slice(0, 7) === addDays(today, 1).slice(0, 7)) {
      const group = all.find((r) => r.date === expectedPayDate(today, 20))!;
      expect(group.count).toBeGreaterThanOrEqual(2);
      // Um total só por data, com o que é e o que não é por CNPJ (R$ 1.000,00 + R$ 800,00, pelo menos).
      expect(plain(group.total)).toMatch(/^R\$ \d/);
    }
    // O plantão recebido (de outro mês de pagamento) não gera grupo de previsão.
    expect(all.some((r) => r.date === expectedPayDate(addDays(today, -130), 20) && r.date !== dueOverdue)).toBe(false);
    void overdue;
  });
});
