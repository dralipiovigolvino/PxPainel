import { z } from "zod";
import { parseCnpj } from "@/lib/cnpj";
import { parseRate } from "@/lib/tax";
import { isUuid } from "@/modules/financas/domain/filters";

export { DEFAULT_TAX_DUE_DAY } from "./tax";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export const CNPJ_NAME_MAX = 80;
export const CNPJ_ABBREVIATION_MAX = 20;

/** Cadastro do CNPJ: nome, número (opcional), estimativa de imposto e dia do pagamento. */
export const cnpjSchema = z.object({
  name: z
    .string({ error: "Nome inválido." })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => !CONTROL_CHARS.test(v), "O nome contém caracteres inválidos.")
    .refine((v) => [...v].length <= CNPJ_NAME_MAX, `Use no máximo ${CNPJ_NAME_MAX} caracteres.`)
    .refine((v) => v.length > 0, "Informe um nome para o CNPJ."),
  abbreviation: z
    .string({ error: "Abreviação inválida." })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => !CONTROL_CHARS.test(v), "A abreviação contém caracteres inválidos.")
    .refine((v) => v.length > 0, "Informe a abreviação.")
    .refine((v) => [...v].length <= CNPJ_ABBREVIATION_MAX, `Use no máximo ${CNPJ_ABBREVIATION_MAX} caracteres.`),
  number: z.unknown().transform((value, ctx) => {
    const r = parseCnpj(value);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.cnpj;
  }),
  taxRate: z.unknown().transform((value, ctx) => {
    const r = parseRate(value);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.rateBp;
  }),
  taxDueDay: z
    .string({ error: "Informe o dia do pagamento." })
    .trim()
    .transform((v, ctx) => {
      const day = /^\d{1,2}$/.test(v) ? Number(v) : NaN;
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        ctx.addIssue({ code: "custom", message: "Use um dia de 1 a 31." });
        return z.NEVER;
      }
      return day;
    }),
});
export type CnpjInput = z.output<typeof cnpjSchema>;

/** Marcação "recebo por CNPJ" nos formulários de plantão e de perícia: vazio = sem CNPJ; senão o id do CNPJ. */
export const cnpjIdField = z
  .string({ error: "CNPJ inválido. Atualize a página." })
  .trim()
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .refine((v) => v === null || isUuid(v), "CNPJ inválido. Atualize a página.");
