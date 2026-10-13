import { describe, expect, it } from "vitest";
import { monthRange } from "./filters";
import { areaSchema, entrySchema, fieldErrors, paymentDateSchema } from "./schemas";
import { isOverdue } from "./status";

const TODAY = "2026-09-28";

describe("atraso calculado", () => {
  it("vencendo hoje não está atrasada; ontem e pendente está", () => {
    expect(isOverdue({ status: "pendente", dueDate: "2026-09-28" }, TODAY)).toBe(false);
    expect(isOverdue({ status: "pendente", dueDate: "2026-09-27" }, TODAY)).toBe(true);
    expect(isOverdue({ status: "pendente", dueDate: "2026-09-29" }, TODAY)).toBe(false);
  });

  it("conta paga nunca está atrasada", () => {
    expect(isOverdue({ status: "pago", dueDate: "2026-01-01" }, TODAY)).toBe(false);
  });

});

describe("intervalo do mês", () => {
  it("intervalo do mês respeita fevereiro bissexto", () => {
    expect(monthRange({ year: 2024, month: 2 })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange({ year: 2026, month: 2 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("validação de área", () => {
  it("normaliza nome e cor", () => {
    expect(areaSchema.parse({ name: "  Casa   e  Carro ", color: "#1E3A8A" })).toEqual({ name: "Casa e Carro", color: "#1e3a8a" });
  });

  it("recusa nome vazio, só espaços ou longo demais", () => {
    expect(areaSchema.safeParse({ name: "   ", color: "#1e3a8a" }).success).toBe(false);
    expect(areaSchema.safeParse({ name: "a".repeat(61), color: "#1e3a8a" }).success).toBe(false);
  });

  it("recusa CSS arbitrário como cor", () => {
    for (const color of ["red", "#fff", "rgb(0,0,0)", "#1e3a8a;background:url(x)", "var(--x)"]) {
      expect(areaSchema.safeParse({ name: "Área", color }).success, color).toBe(false);
    }
  });
});

describe("validação de lançamento", () => {
  const base = {
    description: "  Conta de luz ",
    amountCents: "1.234,56",
    dueDate: "2026-09-30",
    areaId: "3f2b8c1e-7a4d-4e9b-9c1a-2d5e6f708192",
    category: "",
    notes: "  ",
  };

  it("aceita e normaliza", () => {
    expect(entrySchema.parse(base)).toEqual({
      description: "Conta de luz",
      amountCents: 123456,
      dueDate: "2026-09-30",
      areaId: base.areaId,
      category: null,
      notes: null,
      paymentMethod: null,
    });
  });

  it("forma de pagamento: Pix ou boleto; outra forma é recusada", () => {
    expect(entrySchema.parse({ ...base, paymentMethod: "boleto" }).paymentMethod).toBe("boleto");
    const r = entrySchema.safeParse({ ...base, paymentMethod: "dinheiro" });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).paymentMethod).toBe("Escolha Pix ou boleto.");
  });

  it("recusa descrição vazia, valor inválido, data inexistente e área ausente", () => {
    const result = entrySchema.safeParse({ ...base, description: " ", amountCents: "0", dueDate: "2026-02-30", areaId: "" });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({
      description: "Informe a descrição.",
      amountCents: "O valor deve ser maior que zero.",
      dueDate: "Data inválida.",
      areaId: "Escolha a área.",
    });
  });

  it("recusa vencimento fora do intervalo permitido", () => {
    expect(entrySchema.safeParse({ ...base, dueDate: "1999-12-31" }).success).toBe(false);
  });

  it("observação preserva quebras de linha", () => {
    expect(entrySchema.parse({ ...base, notes: "linha 1\r\nlinha 2" }).notes).toBe("linha 1\nlinha 2");
  });
});

describe("data de pagamento", () => {
  it("aceita hoje e passado, recusa futuro", () => {
    const schema = paymentDateSchema(TODAY);
    expect(schema.safeParse("2026-09-28").success).toBe(true);
    expect(schema.safeParse("2026-01-10").success).toBe(true);
    expect(schema.safeParse("2026-09-29").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });
});
