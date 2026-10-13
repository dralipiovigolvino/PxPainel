import { describe, expect, it } from "vitest";
import { addToKindSums, emptyKindSums, expectedPayDate, groupForecast, type ForecastShift, sumsTotal } from "./payment";

describe("previsão de pagamento dos plantões", () => {
  it("dia 20 do mês seguinte ao do início do plantão", () => {
    expect(expectedPayDate("2026-10-01", 20)).toBe("2026-11-20");
    expect(expectedPayDate("2026-10-31", 20)).toBe("2026-11-20");
  });

  it("permite escolher o mesmo mês sem alterar o padrão antigo", () => {
    expect(expectedPayDate("2026-10-01", 20, 0)).toBe("2026-10-20");
    expect(expectedPayDate("2026-02-05", 31, 0)).toBe("2026-02-28");
    expect(expectedPayDate("2026-10-01", 20)).toBe("2026-11-20");
  });

  it("virada de ano", () => {
    expect(expectedPayDate("2026-12-15", 20)).toBe("2027-01-20");
    expect(expectedPayDate("2026-12-31", 5)).toBe("2027-01-05");
  });

  it("dias 29 a 31: usa o último dia quando o mês de pagamento não tem o dia", () => {
    expect(expectedPayDate("2027-01-10", 29)).toBe("2027-02-28");
    expect(expectedPayDate("2027-01-10", 30)).toBe("2027-02-28");
    expect(expectedPayDate("2027-01-10", 31)).toBe("2027-02-28");
    expect(expectedPayDate("2028-01-10", 30)).toBe("2028-02-29"); // bissexto
    expect(expectedPayDate("2026-03-05", 31)).toBe("2026-04-30");
    expect(expectedPayDate("2026-04-05", 31)).toBe("2026-05-31");
  });

  it("plantão noturno que termina no mês seguinte usa o mês do INÍCIO", () => {
    // Começa em 31/10 e termina em 01/11: a referência é outubro → pagamento em novembro.
    expect(expectedPayDate("2026-10-31", 10)).toBe("2026-11-10");
  });

  it("rejeita dia inválido", () => {
    expect(() => expectedPayDate("2026-10-01", 0)).toThrow();
    expect(() => expectedPayDate("2026-10-01", 32)).toThrow();
  });

  const shift = (id: string, date: string, expected: string, amountCents: number, kind: ForecastShift["amountKind"], rate: number | null): ForecastShift => ({
    id,
    typeName: "Tipo",
    date,
    status: "agendado",
    amountCents,
    amountKind: kind,
    taxRateBp: rate,
    expectedPayDate: expected,
    expectedPayManual: false,
  });

  it("agrupa vários plantões na mesma data de pagamento, sem misturar bruto, líquido e não definido", () => {
    const groups = groupForecast(
      [
        shift("b", "2026-10-08", "2026-11-20", 100000, "bruto", 900),
        shift("a", "2026-10-01", "2026-11-20", 100000, "bruto", 900),
        shift("c", "2026-10-15", "2026-11-20", 80000, "liquido", null),
        shift("d", "2026-10-20", "2026-11-20", 50000, null, null),
        shift("e", "2026-09-10", "2026-10-02", 70000, "liquido", null),
      ],
      "2026-10-04",
    );
    expect(groups.map((g) => [g.date, g.overdue, g.shifts.map((s) => s.id)])).toEqual([
      ["2026-10-02", true, ["e"]],
      ["2026-11-20", false, ["a", "b", "c", "d"]],
    ]);
    // 2 brutos de R$ 1.000,00 a 9%: R$ 2.000,00 brutos, R$ 180,00 de imposto estimado, R$ 1.820,00 após impostos.
    expect(groups[1].sums).toEqual({ count: 4, gross: 200000n, grossTax: 18000n, grossNet: 182000n, net: 80000n, undefinedKind: 50000n, grossCount: 2, netCount: 1, undefinedCount: 1 });
  });

  it("previsão para hoje não está vencida", () => {
    expect(groupForecast([shift("a", "2026-09-01", "2026-10-04", 100, "liquido", null)], "2026-10-04")[0].overdue).toBe(false);
  });

  it("valor líquido não sofre desconto; alíquota gravada é a usada", () => {
    const sums = emptyKindSums();
    addToKindSums(sums, { amountCents: 100000, amountKind: "liquido", taxRateBp: null });
    addToKindSums(sums, { amountCents: 100000, amountKind: "bruto", taxRateBp: 1100 });
    expect(sums).toMatchObject({ net: 100000n, gross: 100000n, grossTax: 11000n, grossNet: 89000n });
    // Total do grupo: o que é por CNPJ (bruto) mais o que não é.
    expect(sumsTotal(sums)).toBe(200000n);
  });
});

describe("campos do formulário", () => {
  it("dia de pagamento: vazio = sem previsão; 1 a 31", async () => {
    const { payDayField } = await import("./schemas");
    expect(payDayField.parse("")).toBeNull();
    expect(payDayField.parse(" 20 ")).toBe(20);
    expect(payDayField.parse("1")).toBe(1);
    expect(payDayField.parse("31")).toBe(31);
    for (const bad of ["0", "32", "x", "2,5", "-1"]) expect(payDayField.safeParse(bad).success).toBe(false);
  });
});
