import { describe, expect, it } from "vitest";
import { chargeReferences, cycleDates, cycleDueIn, cycleForPurchase, invoiceTotal } from "./cards";
import { splitCents } from "./installments";

describe("cycleForPurchase — fecha dia 10, vence dia 17", () => {
  it("compra antes do fechamento entra na fatura que fecha no mesmo mês", () => {
    expect(cycleForPurchase("2026-09-09", 10, 17)).toEqual({ reference: "2026-09", closingDate: "2026-09-10", dueDate: "2026-09-17" });
  });

  it("compra NO dia do fechamento vai para a próxima", () => {
    expect(cycleForPurchase("2026-09-10", 10, 17)).toEqual({ reference: "2026-10", closingDate: "2026-10-10", dueDate: "2026-10-17" });
  });

  it("compra depois do fechamento vai para a próxima", () => {
    expect(cycleForPurchase("2026-09-25", 10, 17).reference).toBe("2026-10");
  });
});

describe("vencimento no mês seguinte e virada de ano", () => {
  it("vencimento menor ou igual ao fechamento cai no mês seguinte", () => {
    expect(cycleForPurchase("2026-12-01", 25, 5)).toEqual({ reference: "2026-12", closingDate: "2026-12-25", dueDate: "2027-01-05" });
    expect(cycleDates({ year: 2026, month: 9 }, 10, 10)).toEqual({ reference: "2026-09", closingDate: "2026-09-10", dueDate: "2026-10-10" });
  });

  it("compra depois do fechamento de dezembro vai para janeiro do ano seguinte", () => {
    expect(cycleForPurchase("2026-12-28", 25, 5)).toEqual({ reference: "2027-01", closingDate: "2027-01-25", dueDate: "2027-02-05" });
  });
});

describe("fevereiro e dias 29 a 31", () => {
  it("fechamento dia 31 em fevereiro vira o último dia (28 ou 29)", () => {
    expect(cycleDates({ year: 2026, month: 2 }, 31, 10)).toEqual({ reference: "2026-02", closingDate: "2026-02-28", dueDate: "2026-03-10" });
    expect(cycleDates({ year: 2024, month: 2 }, 30, 31)).toEqual({ reference: "2024-02", closingDate: "2024-02-29", dueDate: "2024-02-29" });
  });

  it("compra em 28/02 com fechamento 31 (ajustado a 28) é no dia do fechamento → março", () => {
    expect(cycleForPurchase("2026-02-28", 31, 10)).toEqual({ reference: "2026-03", closingDate: "2026-03-31", dueDate: "2026-04-10" });
    expect(cycleForPurchase("2026-02-27", 31, 10).reference).toBe("2026-02");
  });

  it("vencimento dia 31 em abril vira 30", () => {
    expect(cycleDates({ year: 2026, month: 3 }, 29, 31)).toEqual({ reference: "2026-03", closingDate: "2026-03-29", dueDate: "2026-03-31" });
    expect(cycleDates({ year: 2026, month: 4 }, 29, 31).dueDate).toBe("2026-04-30");
  });
});

describe("fatura pelo mês do vencimento", () => {
  it("vencimento depois do fechamento: a fatura que vence no mês fecha no mesmo mês", () => {
    expect(cycleDueIn({ year: 2026, month: 10 }, 10, 17)).toEqual({ reference: "2026-10", closingDate: "2026-10-10", dueDate: "2026-10-17" });
  });

  it("vencimento antes (ou no dia) do fechamento: a fatura que vence no mês fechou no mês anterior", () => {
    expect(cycleDueIn({ year: 2026, month: 10 }, 28, 5)).toEqual({ reference: "2026-09", closingDate: "2026-09-28", dueDate: "2026-10-05" });
    expect(cycleDueIn({ year: 2027, month: 1 }, 25, 5).reference).toBe("2026-12");
    expect(cycleDueIn({ year: 2026, month: 10 }, 10, 10).dueDate).toBe("2026-10-10");
  });
});

describe("valor que conta para a fatura", () => {
  const base = { status: "pendente" as const, paidTotalCents: null, statedCents: null, detailedCents: 100000 };

  it("sem total informado: a soma das compras cadastradas", () => {
    expect(invoiceTotal(base)).toBe(100000);
  });

  it("com total informado: o informado, maior ou menor que a soma (as compras nunca somam por fora)", () => {
    expect(invoiceTotal({ ...base, statedCents: 250000 })).toBe(250000);
    expect(invoiceTotal({ ...base, statedCents: 70000 })).toBe(70000);
    expect(invoiceTotal({ ...base, statedCents: 80000, detailedCents: 0 })).toBe(80000);
  });

  it("paga: o valor pago, mesmo que a soma das compras tenha mudado depois", () => {
    expect(invoiceTotal({ status: "pago", paidTotalCents: 250000, statedCents: 250000, detailedCents: 130000 })).toBe(250000);
    // Pagamento antigo, feito pela soma, sem total informado.
    expect(invoiceTotal({ status: "pago", paidTotalCents: 100000, statedCents: null, detailedCents: 100000 })).toBe(100000);
  });
});

describe("parcelas no cartão", () => {
  it("ocupam ciclos mensais consecutivos, atravessando o ano", () => {
    expect(chargeReferences("2026-11", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("arredondamento: resto nas primeiras parcelas, soma exata", () => {
    const parts = splitCents(100000, 3);
    expect(parts).toEqual([33334, 33333, 33333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100000);
  });

});
