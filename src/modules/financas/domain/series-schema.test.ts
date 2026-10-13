import { describe, expect, it } from "vitest";
import { fieldErrors, seriesSchema, variableEntrySchema } from "./schemas";

const AREA = "3f2b8c1e-7a4d-4e9b-9c1a-2d5e6f708192";
const base = {
  description: " Aluguel ",
  areaId: AREA,
  category: "",
  notes: "",
  amountKind: "fixo",
  amount: "1.500,00",
  frequency: "mensal",
  intervalMonths: "1",
  startDate: "2026-01-31",
  endDate: "",
};

describe("seriesSchema", () => {
  it("aceita série mensal fixa", () => {
    expect(seriesSchema.parse(base)).toEqual({
      description: "Aluguel",
      areaId: AREA,
      category: null,
      notes: null,
      amountKind: "fixo",
      amountCents: 150000,
      frequency: "mensal",
      intervalMonths: 1,
      startDate: "2026-01-31",
      endDate: null,
      paymentMethod: null,
    });
    expect(seriesSchema.parse({ ...base, paymentMethod: "pix" }).paymentMethod).toBe("pix");
  });

  it("variável não tem valor na regra, mesmo se algo for digitado", () => {
    expect(seriesSchema.parse({ ...base, amountKind: "variavel", amount: "" }).amountCents).toBeNull();
    expect(seriesSchema.parse({ ...base, amountKind: "variavel", amount: "99,00" }).amountCents).toBeNull();
  });

  it("fixo exige valor válido", () => {
    const r = seriesSchema.safeParse({ ...base, amount: "" });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).amount).toBe("Informe o valor.");
  });

  it("a cada N meses exige inteiro de 1 a 24; semanal ignora o intervalo", () => {
    expect(seriesSchema.parse({ ...base, intervalMonths: "6" }).intervalMonths).toBe(6);
    for (const bad of ["0", "25", "1.5", "-1", "", "abc"]) {
      const r = seriesSchema.safeParse({ ...base, intervalMonths: bad });
      expect(r.success, bad).toBe(false);
      expect(fieldErrors(r.error!).intervalMonths).toBe("Use um número inteiro de 1 a 24.");
    }
    expect(seriesSchema.parse({ ...base, frequency: "semanal", intervalMonths: "abc" }).intervalMonths).toBe(1);
  });

  it("data final opcional e não anterior à primeira", () => {
    expect(seriesSchema.parse({ ...base, endDate: "2026-12-31" }).endDate).toBe("2026-12-31");
    const r = seriesSchema.safeParse({ ...base, endDate: "2025-12-31" });
    expect(fieldErrors(r.error!).endDate).toBe("A data final não pode ser anterior à primeira data.");
  });

  it("periodicidade desconhecida é recusada", () => {
    expect(seriesSchema.safeParse({ ...base, frequency: "diaria" }).success).toBe(false);
  });
});

describe("variableEntrySchema", () => {
  it("valor vazio = a informar (null), nunca zero", () => {
    const r = variableEntrySchema.parse({
      description: "Luz",
      amountCents: "",
      dueDate: "2026-09-10",
      areaId: AREA,
      category: "",
      notes: "",
    });
    expect(r.amountCents).toBeNull();
  });
});
