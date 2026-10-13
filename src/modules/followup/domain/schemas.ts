import { z } from "zod";
import { parseCivilDate, type CivilDate } from "@/lib/dates";
import { checkDuration, MAX_DURATION_DAYS } from "./deadline";
import { messageError, normalizeMessage } from "./messages";
import { normalizePhone } from "./phone";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const NOTES_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const length = (value: string) => [...value].length; // como char_length do PostgreSQL

export const PATIENT_NAME_MAX = 120;
export const PATIENT_NOTES_MAX = 1000;
export const CONSULT_NOTES_MAX = 2000;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 500;
export const STEP_NOTE_MAX = 1000;
export const REASON_MAX = 300;
/** Intervalo máximo de uma etapa: 3650 dias (10 anos). */
export const MAX_DAY_OFFSET = 3650;
export const MAX_TEMPLATE_STEPS = 30;
export const MIN_CONSULT_DATE = "2000-01-01";

function singleLine(label: string, max: number) {
  return z
    .string({ error: `${label} inválido.` })
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => !CONTROL_CHARS.test(value), `${label} contém caracteres inválidos.`)
    .refine((value) => length(value) <= max, `Use no máximo ${max} caracteres.`);
}

/** Texto livre opcional (quebras de linha permitidas); vazio = null. */
export function notesField(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => !NOTES_CONTROL_CHARS.test(value), "O texto contém caracteres inválidos.")
    .refine((value) => length(value) <= max, `Use no máximo ${max} caracteres.`)
    .transform((value) => (value === "" ? null : value));
}

export const patientSchema = z.object({
  name: singleLine("Nome", PATIENT_NAME_MAX).refine((v) => v.length > 0, "Informe o nome do paciente."),
  phone: z.string().transform((value, ctx) => {
    const result = normalizePhone(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.e164;
  }),
  notes: notesField(PATIENT_NOTES_MAX),
});
export type PatientInput = z.output<typeof patientSchema>;

/** Data de consulta REALIZADA: data civil válida, não futura (São Paulo). */
export function consultDateSchema(today: CivilDate) {
  return z
    .string({ error: "Informe a data da consulta." })
    .trim()
    .refine((value) => value.length > 0, "Informe a data da consulta.")
    .refine((value) => parseCivilDate(value) !== null, "Data inválida.")
    .refine((value) => value >= MIN_CONSULT_DATE, "Data anterior a 2000 não é aceita.")
    .refine((value) => value <= today, "A consulta não pode ter data futura: registre depois de realizada.");
}

export function consultationSchema(today: CivilDate) {
  return z.object({ consultDate: consultDateSchema(today), notes: notesField(CONSULT_NOTES_MAX) });
}

export type TemplateStepInput = { dayOffset: number; message: string };

/** Etapas chegam como JSON (lista ordenada do formulário). */
const stepsField = z.string().transform((value, ctx): TemplateStepInput[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Etapas inválidas. Recarregue a página." });
    return z.NEVER;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    ctx.addIssue({ code: "custom", message: "Inclua pelo menos uma etapa." });
    return z.NEVER;
  }
  if (parsed.length > MAX_TEMPLATE_STEPS) {
    ctx.addIssue({ code: "custom", message: `Use no máximo ${MAX_TEMPLATE_STEPS} etapas.` });
    return z.NEVER;
  }
  const steps: TemplateStepInput[] = [];
  const seen = new Set<number>();
  parsed.forEach((raw, i) => {
    const item = raw as { dayOffset?: unknown; message?: unknown };
    const offsetText = String(item?.dayOffset ?? "").trim();
    const dayOffset = /^\d{1,4}$/.test(offsetText) ? Number(offsetText) : NaN;
    const message = typeof item?.message === "string" ? normalizeMessage(item.message) : "";
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > MAX_DAY_OFFSET) {
      ctx.addIssue({ code: "custom", path: [`step-${i}-offset`], message: `Use um número inteiro de 0 a ${MAX_DAY_OFFSET} dias.` });
    } else if (seen.has(dayOffset)) {
      ctx.addIssue({ code: "custom", path: [`step-${i}-offset`], message: `D${dayOffset} já existe neste modelo.` });
    } else seen.add(dayOffset);
    const error = messageError(message);
    if (error) ctx.addIssue({ code: "custom", path: [`step-${i}-message`], message: error });
    steps.push({ dayOffset, message });
  });
  return steps;
});

/** Número inteiro de dias digitado; vazio = não informado. */
const daysText = z.string().trim().default("");
const toDays = (text: string) => (/^\d{1,4}$/.test(text) ? Number(text) : NaN);

/**
 * Duração e aviso (opcionais no modelo): vazios = sem duração. Com duração, o aviso é obrigatório
 * e os dois precisam ser coerentes com as etapas (nenhuma etapa é removida para caber).
 */
function withDuration<T extends { durationDays: string; noticeDays: string }>(value: T, offsets: number[], ctx: z.RefinementCtx): { durationDays: number | null; noticeDays: number | null } {
  // Sem duração não há aviso: o valor sugerido no campo de aviso é ignorado.
  if (value.durationDays === "") return { durationDays: null, noticeDays: null };
  const durationDays = toDays(value.durationDays);
  if (Number.isNaN(durationDays)) {
    ctx.addIssue({ code: "custom", path: ["durationDays"], message: `Use um número inteiro de 1 a ${MAX_DURATION_DAYS} dias.` });
    return { durationDays: null, noticeDays: null };
  }
  const noticeDays = toDays(value.noticeDays);
  if (Number.isNaN(noticeDays)) {
    ctx.addIssue({ code: "custom", path: ["noticeDays"], message: "Informe quantos dias antes do término o aviso deve aparecer (0 = só no último dia)." });
    return { durationDays, noticeDays: null };
  }
  const check = checkDuration(durationDays, noticeDays, offsets);
  if (!check.ok) ctx.addIssue({ code: "custom", path: [check.field], message: check.message });
  return { durationDays, noticeDays };
}

export const templateSchema = z
  .object({
    name: singleLine("Nome", TEMPLATE_NAME_MAX).refine((v) => v.length > 0, "Informe o nome do modelo."),
    description: notesField(TEMPLATE_DESCRIPTION_MAX),
    steps: stepsField,
    durationDays: daysText,
    noticeDays: daysText,
  })
  .transform((value, ctx) => ({
    ...value,
    ...withDuration(
      value,
      value.steps.map((s) => s.dayOffset).filter((d) => Number.isInteger(d)),
      ctx,
    ),
  }));
export type TemplateInput = z.output<typeof templateSchema>;

/** Prazo definido explicitamente num acompanhamento já existente: duração e aviso obrigatórios. */
export const planDeadlineSchema = z.object({ durationDays: daysText, noticeDays: daysText }).transform((value, ctx) => {
  if (value.durationDays === "") {
    ctx.addIssue({ code: "custom", path: ["durationDays"], message: "Informe a duração em dias." });
    return { durationDays: 0, noticeDays: 0 };
  }
  const r = withDuration(value, [], ctx);
  return { durationDays: r.durationDays ?? 0, noticeDays: r.noticeDays ?? 0 };
});

/** Próxima consulta: data obrigatória (de hoje em diante), horário opcional. */
export function appointmentSchema(today: CivilDate) {
  return z.object({
    date: z
      .string({ error: "Informe a data." })
      .trim()
      .refine((v) => v.length > 0, "Informe a data.")
      .refine((v) => parseCivilDate(v) !== null, "Data inválida.")
      .refine((v) => v <= "2100-12-31", "Data fora do intervalo permitido.")
      .refine((v) => v >= today, "A próxima consulta precisa ser hoje ou em data futura. Consulta já realizada é registrada em \"Registrar consulta\"."),
    time: z
      .string()
      .trim()
      .refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Horário inválido. Use HH:MM.")
      .transform((v) => (v === "" ? null : v)),
  });
}

/** Campo → primeira mensagem de erro. Para "steps", o caminho interno (step-N-…) vira a chave. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? "form");
    result[key] ??= issue.message;
    if (issue.path[0] === "steps") result.steps ??= "Revise as etapas destacadas.";
  }
  return result;
}
