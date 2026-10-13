import { describe, expect, it } from "vitest";
import { messageError, renderMessage, stepLabel, unknownVariables } from "./messages";
import { formatPhone, normalizePhone } from "./phone";
import { consultationSchema, fieldErrors, patientSchema, templateSchema } from "./schemas";

describe("telefone", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11987654321", "+5511987654321"],
    ["011 98765-4321", "+5511987654321"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["55 11 98765 4321", "+5511987654321"],
    ["(21) 3333-4444", "+552133334444"],
    ["+1 415 555 2671", "+14155552671"],
    ["0044 20 7946 0958", "+442079460958"],
    ["", null],
    ["   ", null],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164: expected });
  });
  it.each(["123", "(11) 8765-432", "(11) 88765-4321", "abc", "11 9876+54321", "+0 123 456 789", "(10) 98765-4321"])("recusa %s com orientação", (input) => {
    const r = normalizePhone(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ex\.:/);
  });
  it("formata para exibição", () => {
    expect(formatPhone("+5511987654321")).toBe("+55 (11) 98765-4321");
    expect(formatPhone("+552133334444")).toBe("+55 (21) 3333-4444");
    expect(formatPhone("+14155552671")).toBe("+14155552671");
    expect(formatPhone(null)).toBe("");
  });
});

describe("mensagens e variáveis", () => {
  const ctx = { patientName: "Maria da Silva", consultDate: "2026-09-28", dayOffset: 7 };
  it("renderiza as três variáveis e preserva quebras", () => {
    expect(renderMessage("Olá, {nome}!\nConsulta de {data_consulta} ({dia_followup}).", ctx)).toBe("Olá, Maria da Silva!\nConsulta de 28/09/2026 (D7).");
  });
  it("não interpreta HTML nem expressões", () => {
    expect(renderMessage("<b>{nome}</b> ${1+1} {{nome}}", ctx)).toBe("<b>Maria da Silva</b> ${1+1} {Maria da Silva}");
  });
  it("aponta variáveis desconhecidas sem trocá-las por vazio", () => {
    expect(unknownVariables("Oi {nome}, sou {medico}. {medico} {Nome}")).toEqual(["{medico}", "{Nome}"]);
    expect(messageError("Dr. {medico}")).toMatch(/Variável desconhecida: \{medico\}/);
    expect(renderMessage("Dr. {medico}", ctx)).toBe("Dr. {medico}");
    expect(messageError("")).toBe("Escreva a mensagem.");
    expect(messageError("a".repeat(2001))).toMatch(/2000/);
    expect(messageError("Olá {nome}")).toBeNull();
  });
  it("rótulo da etapa", () => {
    expect(stepLabel(0)).toBe("D0");
    expect(stepLabel(30)).toBe("D30");
  });
});

describe("validações", () => {
  it("paciente: nome obrigatório, telefone opcional normalizado", () => {
    expect(patientSchema.parse({ name: "  Ana   Lima ", phone: "", notes: "" })).toEqual({ name: "Ana Lima", phone: null, notes: null });
    expect(patientSchema.parse({ name: "Ana", phone: "(11) 98765-4321", notes: "linha 1\r\nlinha 2" })).toEqual({ name: "Ana", phone: "+5511987654321", notes: "linha 1\nlinha 2" });
    const bad = patientSchema.safeParse({ name: " ", phone: "12", notes: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual(["name", "phone"]);
  });
  it("consulta: retroativa sim, futura não", () => {
    const schema = consultationSchema("2026-09-28");
    expect(schema.safeParse({ consultDate: "2026-09-28", notes: "" }).success).toBe(true);
    expect(schema.safeParse({ consultDate: "2024-02-29", notes: "" }).success).toBe(true);
    expect(schema.safeParse({ consultDate: "2026-09-29", notes: "" }).success).toBe(false);
    expect(schema.safeParse({ consultDate: "2026-02-30", notes: "" }).success).toBe(false);
  });
  it("modelo: intervalos personalizados, sem duplicados, limite 3650", () => {
    const ok = templateSchema.parse({ name: "Pós", description: "", steps: JSON.stringify([{ dayOffset: "0", message: "Oi {nome}" }, { dayOffset: 45, message: "Retorno" }]) });
    expect(ok.steps).toEqual([
      { dayOffset: 0, message: "Oi {nome}" },
      { dayOffset: 45, message: "Retorno" },
    ]);
    const dup = templateSchema.safeParse({ name: "X", description: "", steps: JSON.stringify([{ dayOffset: 7, message: "a" }, { dayOffset: 7, message: "b" }]) });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(fieldErrors(dup.error)["step-1-offset"]).toBe("D7 já existe neste modelo.");
    const limits = templateSchema.safeParse({ name: "X", description: "", steps: JSON.stringify([{ dayOffset: 3651, message: "a" }, { dayOffset: -1, message: "{medico}" }]) });
    expect(limits.success).toBe(false);
    if (!limits.success) {
      const e = fieldErrors(limits.error);
      expect(e["step-0-offset"]).toMatch(/3650/);
      expect(e["step-1-offset"]).toMatch(/0 a 3650/);
      expect(e["step-1-message"]).toMatch(/medico/);
      expect(e.steps).toBe("Revise as etapas destacadas.");
    }
    expect(templateSchema.safeParse({ name: "X", description: "", steps: "[]" }).success).toBe(false);
  });
});
