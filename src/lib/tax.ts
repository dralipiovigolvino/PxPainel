/**
 * Impostos ESTIMADOS sobre valores brutos. Tudo em centavos inteiros e percentual em pontos-base
 * (900 = 9,00%), sem ponto flutuante.
 *
 * Arredondamento: imposto = bruto × percentual, ao centavo mais próximo (meio centavo para cima);
 * valor após impostos = bruto − imposto. Assim imposto + após impostos = bruto, sempre.
 *
 * São estimativas: não representam imposto recolhido nem desconto feito por quem paga.
 */

export const DEFAULT_TAX_RATE_BP = 900;
export const MAX_TAX_RATE_BP = 10_000;

export type AmountKind = "bruto" | "liquido";

export function isValidRateBp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TAX_RATE_BP;
}

/** Imposto estimado e valor após impostos de um valor BRUTO. */
export function estimateTax(grossCents: number, rateBp: number): { taxCents: number; netCents: number } {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new RangeError("Valor bruto inválido");
  if (!isValidRateBp(rateBp)) throw new RangeError("Percentual inválido");
  const taxCents = Number((BigInt(grossCents) * BigInt(rateBp) + 5000n) / 10000n);
  return { taxCents, netCents: grossCents - taxCents };
}

export type AmountBreakdown = {
  /** Classificação do valor informado; null = registro antigo, ainda não definido. */
  kind: AmountKind | null;
  /** Valor informado no registro. */
  amountCents: number;
  /** Alíquota gravada no registro (só em valores brutos). */
  rateBp: number | null;
  /** Imposto estimado; null = não informado (valor líquido) ou não definido. */
  taxCents: number | null;
  /** Valor após a estimativa de impostos; null só quando a classificação não foi definida. */
  netCents: number | null;
};

/**
 * Desdobra o valor de um registro:
 * - bruto: imposto estimado pela alíquota GRAVADA no registro;
 * - líquido: valor mantido, sem novo desconto; imposto original não informado;
 * - não definido: nada é presumido.
 */
export function amountBreakdown(amountCents: number, kind: AmountKind | null, rateBp: number | null): AmountBreakdown {
  if (kind === "bruto" && rateBp !== null) return { kind, amountCents, rateBp, ...estimateTax(amountCents, rateBp) };
  if (kind === "liquido") return { kind, amountCents, rateBp: null, taxCents: null, netCents: amountCents };
  return { kind: null, amountCents, rateBp: null, taxCents: null, netCents: null };
}

/** "9%", "9,5%", "9,25%". */
export function formatRate(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100);
  const cents = rateBp % 100;
  const decimals = cents === 0 ? "" : `,${String(cents).padStart(2, "0").replace(/0$/, "")}`;
  return `${whole}${decimals}%`;
}

/** Valor para o campo de edição: "9", "9,5", "9,25". */
export const formatRateForInput = (rateBp: number) => formatRate(rateBp).slice(0, -1);

export type ParseRateResult = { ok: true; rateBp: number } | { ok: false; error: string };

/** Lê "9", "9,5", "9,25" ou "9%" (vírgula decimal, até 2 casas), de 0 a 100. */
export function parseRate(input: unknown): ParseRateResult {
  if (typeof input !== "string") return { ok: false, error: "Informe o percentual." };
  const text = input.trim().replace(/\s*%$/, "");
  if (text === "") return { ok: false, error: "Informe o percentual." };
  const match = /^(\d{1,3})(?:,(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, error: /,\d{3,}$/.test(text) ? "Use no máximo 2 casas decimais." : "Percentual inválido. Use o formato 9 ou 9,5." };
  const rateBp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (rateBp > MAX_TAX_RATE_BP) return { ok: false, error: "O percentual máximo é 100%." };
  return { ok: true, rateBp };
}
