import { addDays, addMonths, addMonthsAnchored, clampedDate, daysBetween, daysInMonth, parseCivilDate, yearMonthOf, type CivilDate } from "@/lib/dates";

/**
 * Periodicidades. "quinzenal" = a cada 14 dias (não é "duas vezes por mês").
 * "mensal" usa intervalMonths (1 = mensal, 3 = trimestral, 6 = semestral, 12 = anual).
 */
export const FREQUENCIES = ["semanal", "quinzenal", "mensal"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const MAX_INTERVAL_MONTHS = 24;
/** Horizonte padrão de geração: 12 meses à frente. */
export const DEFAULT_HORIZON_MONTHS = 12;
/** Limite de segurança para geração sob demanda (evita pedidos absurdos). */
export const MAX_HORIZON_MONTHS = 120;

/** Último dia do mês de hoje + N meses. */
function endOfMonthAhead(today: CivilDate, months: number): CivilDate {
  const ym = addMonths(yearMonthOf(today), months);
  return clampedDate(ym, daysInMonth(ym.year, ym.month));
}

/**
 * Alvo de geração para uma tela que precisa de dados até `needed`: no mínimo o horizonte padrão,
 * no máximo o limite de segurança. `truncated` = a tela pede além do limite; os totais depois de
 * `limit` NÃO incluem recorrências e a interface precisa dizer isso.
 */
export function generationWindow(needed: CivilDate, today: CivilDate): { target: CivilDate; limit: CivilDate; truncated: boolean } {
  const min = endOfMonthAhead(today, DEFAULT_HORIZON_MONTHS);
  const limit = endOfMonthAhead(today, MAX_HORIZON_MONTHS);
  return { target: needed > limit ? limit : needed < min ? min : needed, limit, truncated: needed > limit };
}

export type RecurrenceRule = {
  /** Primeira data de vencimento; define a âncora (dia do mês / dia da semana). */
  startDate: CivilDate;
  frequency: Frequency;
  /** Só para "mensal": a cada N meses. */
  intervalMonths: number;
  endDate: CivilDate | null;
};

const stepDays = (frequency: Frequency) => (frequency === "semanal" ? 7 : 14);

/** k-ésima ocorrência (k ≥ 0) pela regra, sem limites. */
export function nthOccurrence(rule: RecurrenceRule, k: number): CivilDate {
  if (rule.frequency === "mensal") return addMonthsAnchored(rule.startDate, k * rule.intervalMonths);
  return addDays(rule.startDate, k * stepDays(rule.frequency));
}

/**
 * Datas ORIGINAIS das ocorrências em [from, to] (inclusive), respeitando início e fim da série.
 * Mensal preserva a âncora: uma série do dia 31 cai em 30/04, 28/02 (29 em bissexto) e volta a 31.
 */
export function occurrencesBetween(rule: RecurrenceRule, from: CivilDate, to: CivilDate): CivilDate[] {
  const lower = from > rule.startDate ? from : rule.startDate;
  const upper = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (lower > upper) return [];

  let k: number;
  if (rule.frequency === "mensal") {
    const start = parseCivilDate(rule.startDate)!;
    const low = parseCivilDate(lower)!;
    const monthsDiff = (low.year - start.year) * 12 + (low.month - start.month);
    // Começa um passo antes para não perder a ocorrência do mês de "lower" por causa do ajuste de dia.
    k = Math.max(0, Math.floor(monthsDiff / rule.intervalMonths) - 1);
  } else {
    k = Math.max(0, Math.floor(daysBetween(rule.startDate, lower) / stepDays(rule.frequency)));
  }

  const result: CivilDate[] = [];
  for (let guard = 0; guard < 10_000; guard++, k++) {
    const date = nthOccurrence(rule, k);
    if (date > upper) break;
    if (date >= lower) result.push(date);
  }
  return result;
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** Texto da regra para a interface. */
export function describeRule(rule: Pick<RecurrenceRule, "startDate" | "frequency" | "intervalMonths">): string {
  const parts = parseCivilDate(rule.startDate);
  if (!parts) return "";
  if (rule.frequency === "semanal" || rule.frequency === "quinzenal") {
    const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
    return rule.frequency === "semanal" ? `Semanal (toda ${weekday})` : `A cada 2 semanas (${weekday}, a cada 14 dias)`;
  }
  const every =
    rule.intervalMonths === 1
      ? "Mensal"
      : rule.intervalMonths === 3
        ? "Trimestral"
        : rule.intervalMonths === 6
          ? "Semestral"
          : rule.intervalMonths === 12
            ? "Anual"
            : `A cada ${rule.intervalMonths} meses`;
  const adjust = parts.day > 28 ? " (ajusta ao último dia quando o mês é menor)" : "";
  return `${every}, dia ${parts.day}${adjust}`;
}
