import { addDays, daysBetween, formatCivilDate, type CivilDate } from "@/lib/dates";

/**
 * Horários de plantão (relógio de São Paulo, sem fuso nem milissegundos).
 * - Ambos vazios, ou início + fim + "termina no dia seguinte".
 * - No mesmo dia: fim > início. No dia seguinte: fim <= início (até 24 h; 07:00 → 07:00 = 24 h).
 */
export type Hours = { start: string; end: string; nextDay: boolean } | null;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const toMinutes = (hhmm: string) => {
  const m = TIME.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export type HoursResult = { ok: true; hours: Hours } | { ok: false; field: "start" | "end" | "nextDay"; error: string };

/** Valida o trio vindo do formulário ("HH:MM", "HH:MM", "sim"/"nao"). */
export function parseHours(start: string, end: string, nextDay: boolean): HoursResult {
  const s = start.trim();
  const e = end.trim();
  if (s === "" && e === "") return { ok: true, hours: null };
  if (s === "") return { ok: false, field: "start", error: "Informe o início junto com o fim (ou deixe os dois vazios)." };
  if (e === "") return { ok: false, field: "end", error: "Informe o fim junto com o início (ou deixe os dois vazios)." };
  if (!TIME.test(s)) return { ok: false, field: "start", error: "Use o formato HH:MM." };
  if (!TIME.test(e)) return { ok: false, field: "end", error: "Use o formato HH:MM." };
  const sm = toMinutes(s);
  const em = toMinutes(e);
  if (!nextDay && em <= sm) {
    return { ok: false, field: "end", error: "Fim igual ou antes do início: marque \"termina no dia seguinte\" (ex.: 19:00 → 07:00 ou 24 h)." };
  }
  if (nextDay && em > sm) return { ok: false, field: "nextDay", error: "Terminando no dia seguinte, o plantão passaria de 24 h. Revise os horários." };
  return { ok: true, hours: { start: s, end: e, nextDay } };
}

/** Duração em minutos (24 h quando início = fim no dia seguinte). */
export function durationMinutes(h: NonNullable<Hours>): number {
  return toMinutes(h.end) + (h.nextDay ? 1440 : 0) - toMinutes(h.start);
}

const formatDuration = (min: number) => (min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

/** "07:00 → 19:00 (12 h)" ou "19:00 → 07:00 do dia 06/10/2026 (12 h)". */
export function describeHours(h: Hours, date?: CivilDate): string {
  if (!h) return "Sem horário definido";
  const end = h.nextDay ? `${h.end} do dia ${date ? formatCivilDate(addDays(date, 1)) : "seguinte"}` : h.end;
  return `${h.start} → ${end} (${formatDuration(durationMinutes(h))})`;
}

/** Data de término (dia seguinte quando atravessa a meia-noite). */
export const endDate = (date: CivilDate, h: Hours) => (h?.nextDay ? addDays(date, 1) : date);

export type TimedShift = { id: string; date: CivilDate; hours: Hours };

/** Intervalo absoluto em minutos a partir de uma data-base (permite comparar dias vizinhos). */
function span(base: CivilDate, s: TimedShift): [number, number] | null {
  if (!s.hours) return null;
  const day = daysBetween(base, s.date) * 1440;
  const start = day + toMinutes(s.hours.start);
  return [start, start + durationMinutes(s.hours)];
}

/**
 * Plantões que se sobrepõem a `candidate` (incluindo um noturno do dia anterior).
 * Sem horário não dá para saber: não entra no aviso de sobreposição.
 */
export function overlapping(candidate: TimedShift, others: TimedShift[]): TimedShift[] {
  const base = addDays(candidate.date, -1);
  const c = span(base, candidate);
  if (!c) return [];
  return others.filter((o) => {
    if (o.id === candidate.id) return false;
    const r = span(base, o);
    return r !== null && r[0] < c[1] && c[0] < r[1];
  });
}
