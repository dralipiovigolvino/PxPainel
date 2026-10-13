import { z } from "zod";
import { parseCivilDate } from "@/lib/dates";
import { parseBrlToCents } from "@/lib/money";
import { cnpjIdField } from "@/modules/cnpj/domain/schemas";
import { parseHours, type Hours } from "./hours";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const NOTES_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const length = (value: string) => [...value].length;

export const TYPE_NAME_MAX = 60;
export const LOCATION_MAX = 120;
export const NOTES_MAX = 1000;
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2100-12-31";

/** Paleta sugerida (o servidor aceita qualquer #rrggbb). */
export const TYPE_COLORS = [
  { value: "#2563eb", label: "Azul" },
  { value: "#0891b2", label: "Ciano" },
  { value: "#16a34a", label: "Verde" },
  { value: "#ca8a04", label: "Mostarda" },
  { value: "#ea580c", label: "Laranja" },
  { value: "#dc2626", label: "Vermelho" },
  { value: "#db2777", label: "Rosa" },
  { value: "#9333ea", label: "Roxo" },
  { value: "#1e3a8a", label: "Azul-marinho" },
  { value: "#475569", label: "Cinza" },
] as const;

function singleLine(label: string, max: number) {
  return z
    .string({ error: `${label} inválido.` })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => !CONTROL_CHARS.test(v), `${label} contém caracteres inválidos.`)
    .refine((v) => length(v) <= max, `Use no máximo ${max} caracteres.`);
}

export const notesField = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, "\n").trim())
  .refine((v) => !NOTES_CONTROL_CHARS.test(v), "Observação contém caracteres inválidos.")
  .refine((v) => length(v) <= NOTES_MAX, `Use no máximo ${NOTES_MAX} caracteres.`)
  .transform((v) => (v === "" ? null : v));

/** Valor positivo em centavos, com o parser e os limites de Finanças. */
export const amountField = z.unknown().transform((value, ctx) => {
  const r = parseBrlToCents(value);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.cents;
});

export const civilDateField = (label: string) =>
  z
    .string({ error: `Informe ${label}.` })
    .trim()
    .refine((v) => v.length > 0, `Informe ${label}.`)
    .refine((v) => parseCivilDate(v) !== null, "Data inválida.")
    .refine((v) => v >= MIN_DATE && v <= MAX_DATE, "Data fora do intervalo permitido.");

/** Dia de pagamento no mês seguinte: vazio = sem previsão; 1 a 31. */
export const payDayField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const day = /^\d{1,2}$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      ctx.addIssue({ code: "custom", message: "Use um dia de 1 a 31 ou deixe em branco." });
      return z.NEVER;
    }
    return day;
  });

export const payMonthOffsetField = z
  .string()
  .default("1")
  .transform((v, ctx): 0 | 1 => {
    if (v === "0" || v === "1") return Number(v) as 0 | 1;
    ctx.addIssue({ code: "custom", message: "Escolha este mês ou o mês seguinte." });
    return z.NEVER;
  });

/** Campos de horário (start, end, nextDay) → Hours, com o erro no campo certo. */
const hoursShape = { start: z.string(), end: z.string(), nextDay: z.string() };
function withHours<T extends { start: string; end: string; nextDay: string }>(value: T, ctx: z.RefinementCtx): Hours {
  const r = parseHours(value.start, value.end, value.nextDay === "true");
  if (!r.ok) {
    ctx.addIssue({ code: "custom", path: [r.field], message: r.error });
    return null;
  }
  return r.hours;
}

export const typeSchema = z
  .object({
    name: singleLine("Nome", TYPE_NAME_MAX).refine((v) => v.length > 0, "Informe o nome do tipo."),
    location: singleLine("Local", LOCATION_MAX).transform((v) => (v === "" ? null : v)),
    amount: amountField,
    // "Recebo por CNPJ": o padrão dos novos plantões do tipo (vazio = sem CNPJ).
    cnpjId: cnpjIdField,
    payDay: payDayField.default(null),
    payMonthOffset: payMonthOffsetField,
    color: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Escolha uma cor válida."),
    notes: notesField,
    ...hoursShape,
  })
  .transform(({ start, end, nextDay, ...rest }, ctx) => ({ ...rest, hours: withHours({ start, end, nextDay }, ctx) }));
export type TypeInput = z.output<typeof typeSchema>;

export const shiftSchema = z
  .object({
    date: civilDateField("a data"),
    amount: amountField,
    cnpjId: cnpjIdField,
    // Previsão de pagamento: "auto" segue a regra copiada do tipo; "manual" usa a data informada.
    payMode: z.string(),
    payDate: z.string().trim(),
    payDay: payDayField.default(null),
    payMonthOffset: payMonthOffsetField,
    notes: notesField,
    ...hoursShape,
  })
  .transform(({ start, end, nextDay, payMode, payDate, ...rest }, ctx) => {
    let expectedPayDate: string | null = null;
    if (payMode === "manual") {
      if (payDate === "") ctx.addIssue({ code: "custom", path: ["payDate"], message: "Informe a data prevista ou volte para a regra do tipo." });
      else if (!parseCivilDate(payDate) || payDate < MIN_DATE || payDate > "2101-12-31") ctx.addIssue({ code: "custom", path: ["payDate"], message: "Data inválida." });
      else expectedPayDate = payDate;
    }
    return {
      ...rest,
      /** null = previsão automática (regra do tipo); data = ajuste manual desta ocorrência. */
      expectedPayDate,
      hours: withHours({ start, end, nextDay }, ctx),
    };
  });
export type ShiftInput = z.output<typeof shiftSchema>;

/**
 * Erros de todos os campos de uma vez: o zod não roda a transformação dos horários quando outro
 * campo falha, então os horários são conferidos também aqui (mesma função pura).
 */
export function formErrors(error: z.ZodError, values: { start: string; end: string; nextDay: string }): Record<string, string> {
  const result = fieldErrors(error);
  const hours = parseHours(values.start, values.end, values.nextDay === "true");
  if (!hours.ok) result[hours.field] ??= hours.error;
  return result;
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}

/** Recorrência: dias da semana (0 = domingo) a cada N semanas, desde a data inicial; "until" = data final opcional. */
export const seriesSchema = z
  .object({
    weekdays: z.array(z.string()),
    intervalWeeks: z.string().trim(),
    startDate: civilDateField("a data inicial"),
    until: z.string().trim(),
    amount: amountField,
    cnpjId: cnpjIdField,
    notes: notesField,
    ...hoursShape,
  })
  .transform(({ start, end, nextDay, weekdays, intervalWeeks, until, ...rest }, ctx) => {
    const days = [...new Set(weekdays.map((d) => (/^[0-6]$/.test(d) ? Number(d) : NaN)))];
    if (days.length === 0 || days.some((d) => Number.isNaN(d))) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Escolha pelo menos um dia da semana." });
    const interval = /^\d{1,2}$/.test(intervalWeeks) ? Number(intervalWeeks) : NaN;
    if (!Number.isInteger(interval) || interval < 1 || interval > 12) ctx.addIssue({ code: "custom", path: ["intervalWeeks"], message: "Use de 1 a 12 semanas." });
    let endDate: string | null = null;
    if (until !== "") {
      if (!parseCivilDate(until) || until > MAX_DATE) ctx.addIssue({ code: "custom", path: ["until"], message: "Data inválida." });
      else if (until < rest.startDate) ctx.addIssue({ code: "custom", path: ["until"], message: "A data final não pode ser anterior à inicial." });
      else endDate = until;
    }
    return { ...rest, weekdays: days.sort((a, b) => a - b), intervalWeeks: interval, endDate, hours: withHours({ start, end, nextDay }, ctx) };
  });
export type SeriesFormOutput = z.output<typeof seriesSchema>;
