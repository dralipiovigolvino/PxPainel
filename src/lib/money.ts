/**
 * Valores monetários são sempre centavos inteiros (ex.: R$ 12,34 = 1234).
 * Nunca armazene ou some reais em ponto flutuante.
 */

export type Cents = number;

/** Maior valor aceito em um lançamento: R$ 99.999.999,99 (mesmo limite do banco). */
export const MAX_AMOUNT_CENTS = 9_999_999_999;
export const MIN_AMOUNT_CENTS = 1;

export function isValidCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: unknown): asserts value is Cents {
  if (!isValidCents(value)) {
    throw new RangeError(`Valor em centavos inválido: ${String(value)}`);
  }
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata centavos em reais, ex.: 123456 → "R$ 1.234,56". Aceita bigint para totais. */
export function formatCents(cents: Cents | bigint): string {
  if (typeof cents !== "bigint") assertCents(cents);
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const rest = absolute % 100n;
  const units = absolute / 100n;
  // A string decimal é formatada de forma exata, sem passar por divisão em ponto flutuante.
  const decimal = `${value < 0n ? "-" : ""}${units}.${rest.toString().padStart(2, "0")}`;
  return brlFormatter.format(decimal as `${number}`);
}

/** Centavos para o campo de edição, sem "R$": 123456 → "1.234,56". */
export function formatCentsForInput(cents: Cents): string {
  assertCents(cents);
  const absolute = BigInt(Math.abs(cents));
  const units = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}${units},${(absolute % 100n).toString().padStart(2, "0")}`;
}

export type ParseMoneyResult = { ok: true; cents: Cents } | { ok: false; error: string };

// Reais com milhar por ponto (1.234.567) ou sem separador (1234567), e até 2 decimais após vírgula.
const BRL_PATTERN = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Converte a entrada brasileira em centavos, a partir dos dígitos (sem ponto flutuante).
 * Aceita "1234,56", "1.234,56", "1234", "0,5" e prefixo "R$". Rejeita negativos, zero,
 * frações de centavo, ponto como decimal ("12.5") e valores acima de MAX_AMOUNT_CENTS.
 */
export function parseBrlToCents(input: unknown): ParseMoneyResult {
  if (typeof input !== "string") return { ok: false, error: "Informe o valor." };
  // Só remove espaços nas pontas e após "R$"; espaço no meio do número é inválido.
  const text = input.trim().replace(/^R\$\s*/i, "");
  if (text === "") return { ok: false, error: "Informe o valor." };
  if (text.startsWith("-")) return { ok: false, error: "O valor deve ser positivo." };

  const match = BRL_PATTERN.exec(text);
  if (!match) {
    if (/,\d{3,}$/.test(text)) return { ok: false, error: "Use no máximo 2 casas decimais." };
    return { ok: false, error: "Valor inválido. Use o formato 1.234,56." };
  }

  const reais = BigInt(match[1].replaceAll(".", ""));
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const cents = reais * 100n + fraction;

  if (cents < BigInt(MIN_AMOUNT_CENTS)) return { ok: false, error: "O valor deve ser maior que zero." };
  if (cents > BigInt(MAX_AMOUNT_CENTS)) {
    return { ok: false, error: `O valor máximo é ${formatCents(MAX_AMOUNT_CENTS)}.` };
  }
  return { ok: true, cents: Number(cents) };
}

/**
 * Lê um bigint vindo do PostgreSQL (o driver entrega int8/numeric como texto)
 * sem conversão insegura. Para valores unitários (≤ inteiro seguro).
 */
export function centsFromDb(value: unknown): Cents {
  const big = bigintFromDb(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Valor fora do intervalo seguro");
  }
  return Number(big);
}

/** Lê somas (numeric/int8) do PostgreSQL como bigint exato. */
export function bigintFromDb(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (value === null || value === undefined) return 0n;
  throw new RangeError("Valor monetário inválido vindo do banco");
}
