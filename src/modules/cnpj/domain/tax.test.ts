import { describe, expect, it } from "vitest";
import type { WorkRecord } from "../contract";
import { cnpjIdField, cnpjSchema } from "./schemas";
import { taxDueDate, taxDues, taxPayMonth } from "./tax";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

const record = (id: string, workDate: string, amountCents: number, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  source: "plantao",
  id,
  label: "Plantão",
  workDate,
  cashDate: workDate,
  received: false,
  amountCents,
  cnpjId: A,
  taxRateBp: 900,
  ...extra,
});

describe("imposto estimado no mês seguinte ao do trabalho", () => {
  it("o trabalho de um mês é pago no mês seguinte, inclusive na virada do ano", () => {
    expect(taxPayMonth("2026-10-01")).toEqual({ year: 2026, month: 11 });
    expect(taxPayMonth("2026-10-31")).toEqual({ year: 2026, month: 11 });
    expect(taxPayMonth("2026-12-15")).toEqual({ year: 2027, month: 1 });
  });

  it("dia do pagamento que não existe no mês vira o último dia", () => {
    expect(taxDueDate({ year: 2026, month: 11 }, 20)).toBe("2026-11-20");
    expect(taxDueDate({ year: 2027, month: 2 }, 31)).toBe("2027-02-28");
  });

  it("soma plantões e perícias por CNPJ do mês e estima pelo percentual gravado em cada um", () => {
    const dues = taxDues([
      record("p1", "2026-10-03", 100000),
      record("p2", "2026-10-28", 150000),
      record("e1", "2026-10-10", 50000, { source: "pericia" }),
      record("p3", "2026-11-02", 200000),
    ]);
    expect(dues).toEqual([
      { cnpjId: A, workMonth: { year: 2026, month: 10 }, payMonth: { year: 2026, month: 11 }, baseCents: 300000n, taxCents: 27000n, shifts: 2, exams: 1 },
      { cnpjId: A, workMonth: { year: 2026, month: 11 }, payMonth: { year: 2026, month: 12 }, baseCents: 200000n, taxCents: 18000n, shifts: 1, exams: 0 },
    ]);
  });

  it("o que não é recebido por CNPJ não entra na conta", () => {
    const dues = taxDues([record("com", "2026-10-03", 100000), record("sem", "2026-10-04", 999900, { cnpjId: null, taxRateBp: null }), record("sem-pericia", "2026-10-05", 50000, { source: "pericia", cnpjId: null, taxRateBp: 0 })]);
    expect(dues).toHaveLength(1);
    expect(dues[0].baseCents).toBe(100000n);
    expect(dues[0].taxCents).toBe(9000n);
  });

  it("o mês conta pelo dia do trabalho, não pelo dia em que o valor entrou", () => {
    // Trabalhado em outubro e recebido só em dezembro: o imposto continua sendo o de novembro.
    const dues = taxDues([record("p1", "2026-10-30", 100000, { cashDate: "2026-12-05", received: true })]);
    expect(dues[0].payMonth).toEqual({ year: 2026, month: 11 });
  });

  it("cada registro usa a própria alíquota e o arredondamento é por registro", () => {
    // 9% de R$ 0,05 = 0,45 centavo → 0 em cada um (somados antes dariam 1 centavo).
    expect(taxDues([record("a", "2026-10-01", 5), record("b", "2026-10-02", 5)])[0].taxCents).toBe(0n);
    const mixed = taxDues([record("a", "2026-10-01", 100000, { taxRateBp: 900 }), record("b", "2026-10-02", 100000, { taxRateBp: 1100 })]);
    expect(mixed[0].taxCents).toBe(20000n);
  });

  it("cada CNPJ tem a sua linha no mês", () => {
    const dues = taxDues([record("a", "2026-10-01", 100000), record("b", "2026-10-02", 100000, { cnpjId: B, taxRateBp: 1500 })]);
    expect(dues.map((d) => [d.cnpjId, d.taxCents])).toEqual([
      [A, 9000n],
      [B, 15000n],
    ]);
  });
});

describe("cadastro do CNPJ", () => {
  const valid = { name: "  Clínica   Exemplo ", abbreviation: " Clínica ", number: "11.222.333/0001-81", taxRate: "9,5", taxDueDay: "20" };

  it("normaliza o nome, guarda o número sem pontuação e o percentual em pontos-base", () => {
    expect(cnpjSchema.parse(valid)).toEqual({ name: "Clínica Exemplo", abbreviation: "Clínica", number: "11222333000181", taxRate: 950, taxDueDay: 20 });
  });

  it("o número é opcional", () => {
    expect(cnpjSchema.parse({ ...valid, number: "" }).number).toBeNull();
  });

  it("aponta cada campo com problema", () => {
    const r = cnpjSchema.safeParse({ name: " ", abbreviation: "", number: "11.222.333/0001-80", taxRate: "101", taxDueDay: "32" });
    expect(r.success).toBe(false);
    const byField = Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
    expect(byField).toEqual({
      name: "Informe um nome para o CNPJ.",
      abbreviation: "Informe a abreviação.",
      number: "CNPJ inválido. Confira os números.",
      taxRate: "O percentual máximo é 100%.",
      taxDueDay: "Use um dia de 1 a 31.",
    });
  });

  it("marcação nos formulários: vazio = sem CNPJ; senão um id", () => {
    expect(cnpjIdField.parse("")).toBeNull();
    expect(cnpjIdField.parse(A.toUpperCase())).toBe(A);
    expect(cnpjIdField.safeParse("qualquer").success).toBe(false);
  });
});
