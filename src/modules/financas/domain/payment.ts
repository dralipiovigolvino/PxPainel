/**
 * Formas de pagamento. Contas fora do cartão: Pix ou boleto (registros antigos podem não ter forma
 * informada). Compras no cartão: o próprio cartão. Chaves de filtro: "pix", "boleto", "nenhuma"
 * (sem forma informada) ou o id do cartão.
 */
export const PAYMENT_METHODS = ["pix", "boleto"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { pix: "Pix", boleto: "Boleto" };

export const NO_METHOD = "nenhuma";
export const NO_METHOD_LABEL = "Forma não informada";

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Chave de agrupamento/filtro de uma obrigação. */
export function paymentKey(item: { paymentMethod: PaymentMethod | null; cardId: string | null }): string {
  return item.cardId ?? item.paymentMethod ?? NO_METHOD;
}

/** Nome exibido de uma chave (cartões pelo nome; desconhecido = "Cartão"). */
export function paymentKeyLabel(key: string, cardNames: ReadonlyMap<string, string>): string {
  if (isPaymentMethod(key)) return PAYMENT_LABELS[key];
  if (key === NO_METHOD) return NO_METHOD_LABEL;
  return cardNames.get(key) ?? "Cartão";
}
