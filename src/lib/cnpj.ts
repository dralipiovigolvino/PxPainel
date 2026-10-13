/**
 * Número do CNPJ: 14 caracteres — 12 letras maiúsculas ou dígitos e 2 dígitos verificadores.
 * Aceita o formato só com números e o alfanumérico (em vigor desde julho de 2026); a conta dos
 * dígitos é a mesma nos dois: cada caractere vale o código ASCII − 48, pesos de 2 a 9 da direita para
 * a esquerda, módulo 11.
 *
 * Guardado sem pontuação; a máscara (00.000.000/0000-00) é só de exibição.
 */

const SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Tira pontuação e espaços e põe as letras em maiúsculas. */
export function normalizeCnpj(input: string): string {
  return input.replace(/[\s./-]/g, "").toUpperCase();
}

function checkDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** `value` já normalizado (14 caracteres, sem pontuação). */
export function isValidCnpj(value: string): boolean {
  if (!SHAPE.test(value)) return false;
  // Sequência de um caractere só (00000000000000) passa na conta, mas não é um CNPJ.
  if (/^(.)\1{13}$/.test(value)) return false;
  const base = value.slice(0, 12);
  const first = checkDigit(base);
  return value.slice(12) === `${first}${checkDigit(base + first)}`;
}

/** "11222333000181" → "11.222.333/0001-81". Texto fora do padrão volta como veio. */
export function formatCnpj(value: string): string {
  if (!SHAPE.test(value)) return value;
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}

export type ParseCnpjResult = { ok: true; cnpj: string | null } | { ok: false; error: string };

/** Lê o campo do formulário: vazio = não informado (null); senão 14 caracteres com dígitos verificadores certos. */
export function parseCnpj(input: unknown): ParseCnpjResult {
  if (typeof input !== "string") return { ok: false, error: "CNPJ inválido." };
  const value = normalizeCnpj(input);
  if (value === "") return { ok: true, cnpj: null };
  if (value.length !== 14) return { ok: false, error: "O CNPJ tem 14 caracteres." };
  if (!isValidCnpj(value)) return { ok: false, error: "CNPJ inválido. Confira os números." };
  return { ok: true, cnpj: value };
}
