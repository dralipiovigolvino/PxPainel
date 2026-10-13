/**
 * Utilitários de datas civis (sem horário), sempre no formato YYYY-MM-DD.
 *
 * Regras e exibição nunca usam `new Date("YYYY-MM-DD")`: esse construtor
 * interpreta a string como meia-noite UTC e, em São Paulo, desloca o dia.
 */

export const APP_TIME_ZONE = "America/Sao_Paulo";

/** Data civil no formato YYYY-MM-DD. */
export type CivilDate = string;

export type CivilDateParts = { year: number; month: number; day: number };

/** Mês de calendário, com `month` de 1 a 12. */
export type YearMonth = { year: number; month: number };

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const pad2 = (value: number) => String(value).padStart(2, "0");

function isValidYearMonth(year: number, month: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12;
}

export function daysInMonth(year: number, month: number): number {
  // O dia 0 do mês seguinte é o último dia deste mês; o cálculo é feito em UTC.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia da semana do dia 1 do mês: 0 = domingo, 6 = sábado. */
export function firstWeekdayOfMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export function parseCivilDate(value: string): CivilDateParts | null {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (!isValidYearMonth(year, month)) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function toCivilDate({ year, month, day }: CivilDateParts): CivilDate {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function civilOrThrow(value: CivilDate): CivilDateParts {
  const parts = parseCivilDate(value);
  if (!parts) throw new RangeError(`Data civil inválida: ${value}`);
  return parts;
}

/** Dias desde 1970-01-01 (aritmética em UTC, sem fuso). */
function epochDay(value: CivilDate): number {
  const { year, month, day } = civilOrThrow(value);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function fromEpochDay(days: number): CivilDate {
  const date = new Date(days * 86_400_000);
  return toCivilDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

/** Soma dias a uma data civil. */
export function addDays(value: CivilDate, days: number): CivilDate {
  return fromEpochDay(epochDay(value) + days);
}

/** Diferença em dias (b − a). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return epochDay(b) - epochDay(a);
}

/** Data com o dia desejado, ajustado ao último dia do mês quando não existe (31 → 30/28/29). */
export function clampedDate({ year, month }: YearMonth, day: number): CivilDate {
  return toCivilDate({ year, month, day: Math.min(day, daysInMonth(year, month)) });
}

/** Soma meses preservando a âncora (dia original), com ajuste de fim de mês. */
export function addMonthsAnchored(start: CivilDate, months: number, anchorDay?: number): CivilDate {
  const parts = civilOrThrow(start);
  return clampedDate(addMonths({ year: parts.year, month: parts.month }, months), anchorDay ?? parts.day);
}

/** Formata uma data civil como DD/MM/AAAA, sem conversão de fuso. */
export function formatCivilDate(value: CivilDate): string {
  const parts = parseCivilDate(value);
  if (!parts) throw new RangeError(`Data civil inválida: ${value}`);
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

const saoPauloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Data de hoje em America/Sao_Paulo, independente do fuso do servidor
 * ou do navegador. `now` permite fixar o instante de referência.
 */
export function todayInSaoPaulo(now: Date = new Date()): CivilDate {
  const parts = saoPauloDateFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return toCivilDate({ year: get("year"), month: get("month"), day: get("day") });
}

const saoPauloTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Instante de referência em America/Sao_Paulo: data civil e minutos desde 00:00.
 * Calculado UMA vez por requisição e repassado aos módulos (mesmo "agora" para todos).
 */
export function nowInSaoPaulo(now: Date = new Date()): { date: CivilDate; minutes: number } {
  const [h, m] = saoPauloTimeFormatter.format(now).split(":").map(Number);
  return { date: todayInSaoPaulo(now), minutes: h * 60 + m };
}

/** Lê um mês no formato YYYY-MM (usado em parâmetros de URL). */
export function parseYearMonth(value: string | undefined): YearMonth | null {
  if (!value) return null;
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) return null;
  const [year, month] = match.slice(1).map(Number);
  return isValidYearMonth(year, month) ? { year, month } : null;
}

export function formatYearMonth({ year, month }: YearMonth): string {
  return `${year}-${pad2(month)}`;
}

export function yearMonthOf(date: CivilDate): YearMonth {
  const parts = parseCivilDate(date);
  if (!parts) throw new RangeError(`Data civil inválida: ${date}`);
  return { year: parts.year, month: parts.month };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function isSameYearMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

/** Ex.: "Setembro de 2026". */
export function formatMonthLabel({ year, month }: YearMonth): string {
  const name = MONTH_NAMES[month - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
}
