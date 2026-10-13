import { z } from "zod";
import { cnpjIdField } from "@/modules/cnpj/domain/schemas";
import { isUuid } from "@/modules/financas/domain/filters";
import { amountField, civilDateField, fieldErrors, notesField } from "@/modules/plantoes/domain/schemas";

export { fieldErrors };
export { MAX_DATE, MIN_DATE, NOTES_MAX } from "@/modules/plantoes/domain/schemas";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
export const COMPANY_NAME_MAX = 80;

export const companySchema = z.object({
  name: z
    .string({ error: "Nome inválido." })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => !CONTROL_CHARS.test(v), "O nome contém caracteres inválidos.")
    .refine((v) => [...v].length <= COMPANY_NAME_MAX, `Use no máximo ${COMPANY_NAME_MAX} caracteres.`)
    .refine((v) => v.length > 0, "Informe o nome da empresa."),
  amount: amountField,
  // "Recebo por CNPJ": o padrão das novas perícias da empresa (vazio = sem CNPJ).
  cnpjId: cnpjIdField,
});
export type CompanyInput = z.output<typeof companySchema>;

/** Horário obrigatório, "HH:MM" (24 h). */
const timeField = z
  .string({ error: "Informe o horário." })
  .trim()
  .refine((v) => v.length > 0, "Informe o horário.")
  .refine((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Horário inválido. Use HH:MM.");

export const examSchema = z.object({
  companyId: z.string({ error: "Escolha a empresa." }).refine(isUuid, "Escolha a empresa."),
  date: civilDateField("a data"),
  time: timeField,
  amount: amountField,
  cnpjId: cnpjIdField,
  notes: notesField,
});
export type ExamInput = z.output<typeof examSchema>;
