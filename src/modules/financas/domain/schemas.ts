import { z } from "zod";
import { parseCivilDate, type CivilDate } from "@/lib/dates";
import { parseBrlToCents } from "@/lib/money";
import { isUuid } from "./filters";
import { MAX_CARD_INSTALLMENTS } from "./cards";
import { validateInstallments } from "./installments";
import { isPaymentMethod, type PaymentMethod } from "./payment";
import { FREQUENCIES, MAX_INTERVAL_MONTHS, type Frequency } from "./recurrence";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
// Observação aceita quebra de linha e tabulação.
const NOTES_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const length = (value: string) => [...value].length; // como char_length do PostgreSQL

/** Texto de uma linha: apara, colapsa espaços, sem caracteres de controle. */
function singleLine(label: string, max: number) {
  return z
    .string({ error: `${label} inválido.` })
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => !CONTROL_CHARS.test(value), `${label} contém caracteres inválidos.`)
    .refine((value) => length(value) <= max, `Use no máximo ${max} caracteres.`);
}

export const AREA_NAME_MAX = 60;
export const DESCRIPTION_MAX = 120;
export const CATEGORY_MAX = 40;
export const NOTES_MAX = 1000;
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2100-12-31";

/** Paleta oferecida na interface (o servidor aceita qualquer #rrggbb). */
export const AREA_COLORS = [
  { value: "#1e3a8a", label: "Azul-marinho" },
  { value: "#2563eb", label: "Azul" },
  { value: "#0891b2", label: "Ciano" },
  { value: "#0d9488", label: "Verde-azulado" },
  { value: "#16a34a", label: "Verde" },
  { value: "#65a30d", label: "Verde-oliva" },
  { value: "#ca8a04", label: "Mostarda" },
  { value: "#ea580c", label: "Laranja" },
  { value: "#dc2626", label: "Vermelho" },
  { value: "#db2777", label: "Rosa" },
  { value: "#9333ea", label: "Roxo" },
  { value: "#475569", label: "Cinza" },
] as const;

export const areaNameSchema = singleLine("Nome", AREA_NAME_MAX).refine((value) => value.length > 0, "Informe o nome da área.");

export const areaColorSchema = z
  .string({ error: "Escolha uma cor." })
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Escolha uma cor válida.");

export const areaSchema = z.object({ name: areaNameSchema, color: areaColorSchema });

function civilDate(label: string) {
  return z
    .string({ error: `Informe ${label}.` })
    .trim()
    .refine((value) => value.length > 0, `Informe ${label}.`)
    .refine((value) => parseCivilDate(value) !== null, "Data inválida.")
    .refine((value) => value >= MIN_DATE && value <= MAX_DATE, "Data fora do intervalo permitido.");
}

export const amountSchema = z.unknown().transform((value, ctx) => {
  const result = parseBrlToCents(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }
  return result.cents;
});

/** Valor opcional: vazio = null (valor a informar); preenchido segue as regras normais. */
export const optionalAmountSchema = z.unknown().transform((value, ctx) => {
  if (typeof value === "string" && value.trim() === "") return null;
  const result = parseBrlToCents(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }
  return result.cents;
});

const descriptionField = singleLine("Descrição", DESCRIPTION_MAX).refine((value) => value.length > 0, "Informe a descrição.");
const areaField = z.string({ error: "Escolha a área." }).refine(isUuid, "Escolha a área.");
const categoryField = singleLine("Categoria", CATEGORY_MAX).transform((value) => (value === "" ? null : value));
const notesField = z
  .string()
  .transform((value) => value.replace(/\r\n/g, "\n").trim())
  .refine((value) => !NOTES_CONTROL_CHARS.test(value), "Observação contém caracteres inválidos.")
  .refine((value) => length(value) <= NOTES_MAX, `Use no máximo ${NOTES_MAX} caracteres.`)
  .transform((value) => (value === "" ? null : value));

/** Pix ou boleto; vazio = não informada (só em registros antigos: contas novas exigem a escolha). */
export const paymentMethodField = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim())
  .refine((value) => value === "" || isPaymentMethod(value), "Escolha Pix ou boleto.")
  .transform((value) => (value === "" ? null : (value as PaymentMethod)));

export const entrySchema = z.object({
  description: descriptionField,
  amountCents: amountSchema,
  dueDate: civilDate("o vencimento"),
  areaId: areaField,
  category: categoryField,
  notes: notesField,
  paymentMethod: paymentMethodField,
});

export type EntryInput = z.output<typeof entrySchema>;

/** Edição de uma ocorrência variável: valor pode ficar vazio (a informar). */
export const variableEntrySchema = entrySchema.extend({ amountCents: optionalAmountSchema });

// ---------------------------------------------------------------------------
// Recorrências
// ---------------------------------------------------------------------------

const intervalField = z
  .string({ error: "Informe o intervalo." })
  .trim()
  .transform((value, ctx) => {
    if (!/^\d{1,2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: `Use um número inteiro de 1 a ${MAX_INTERVAL_MONTHS}.` });
      return z.NEVER;
    }
    const n = Number(value);
    if (n < 1 || n > MAX_INTERVAL_MONTHS) {
      ctx.addIssue({ code: "custom", message: `Use um número inteiro de 1 a ${MAX_INTERVAL_MONTHS}.` });
      return z.NEVER;
    }
    return n;
  });

/**
 * Série recorrente. Os campos chegam como texto do formulário.
 * Fixo exige valor; variável não tem valor na regra (cada ocorrência começa "a informar").
 */
export const seriesSchema = z
  .object({
    description: descriptionField,
    areaId: areaField,
    category: categoryField,
    notes: notesField,
    amountKind: z.enum(["fixo", "variavel"], { error: "Escolha o tipo de valor." }),
    amount: z.string(),
    frequency: z.enum(FREQUENCIES, { error: "Escolha a periodicidade." }),
    intervalMonths: z.string(),
    startDate: civilDate("a primeira data de vencimento"),
    endDate: z.string().trim(),
    paymentMethod: paymentMethodField,
  })
  .transform((value, ctx) => {
    let amountCents: number | null = null;
    if (value.amountKind === "fixo") {
      const parsed = parseBrlToCents(value.amount);
      if (!parsed.ok) ctx.addIssue({ code: "custom", path: ["amount"], message: parsed.error });
      else amountCents = parsed.cents;
    }
    let intervalMonths = 1;
    if (value.frequency === "mensal") {
      const parsed = intervalField.safeParse(value.intervalMonths);
      if (!parsed.success) ctx.addIssue({ code: "custom", path: ["intervalMonths"], message: parsed.error.issues[0].message });
      else intervalMonths = parsed.data;
    }
    let endDate: CivilDate | null = null;
    if (value.endDate !== "") {
      if (!parseCivilDate(value.endDate) || value.endDate > MAX_DATE) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Data inválida." });
      } else if (value.endDate < value.startDate) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "A data final não pode ser anterior à primeira data." });
      } else endDate = value.endDate;
    }
    return {
      description: value.description,
      areaId: value.areaId,
      category: value.category,
      notes: value.notes,
      amountKind: value.amountKind,
      amountCents,
      frequency: value.frequency as Frequency,
      intervalMonths,
      startDate: value.startDate,
      endDate,
      paymentMethod: value.paymentMethod,
    };
  });

export type SeriesFormOutput = z.output<typeof seriesSchema>;

// ---------------------------------------------------------------------------
// Parcelamento fora do cartão
// ---------------------------------------------------------------------------

export const planSchema = z
  .object({
    description: descriptionField,
    areaId: areaField,
    category: categoryField,
    notes: notesField,
    total: amountSchema,
    count: z.string().trim(),
    firstDueDate: civilDate("o primeiro vencimento"),
    requestId: z.string().refine(isUuid, "Formulário inválido. Recarregue a página."),
    paymentMethod: paymentMethodField,
  })
  .transform((value, ctx) => {
    const count = /^\d{1,3}$/.test(value.count) ? Number(value.count) : NaN;
    const check = validateInstallments(value.total, count);
    if (!check.ok) ctx.addIssue({ code: "custom", path: [check.field], message: check.message });
    return { ...value, count };
  });

// ---------------------------------------------------------------------------
// Cartões, compras e faturas
// ---------------------------------------------------------------------------

const dayField = (label: string) =>
  z
    .string({ error: `Informe o dia de ${label}.` })
    .trim()
    .transform((value, ctx) => {
      const n = /^\d{1,2}$/.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 31) {
        ctx.addIssue({ code: "custom", message: "Use um dia de 1 a 31." });
        return z.NEVER;
      }
      return n;
    });

export const cardSchema = z.object({
  name: singleLine("Nome", AREA_NAME_MAX).refine((value) => value.length > 0, "Informe o nome do cartão."),
  closingDay: dayField("fechamento"),
  dueDay: dayField("vencimento"),
  notes: notesField,
  /** Área padrão das compras: opcional (vazio = sem padrão; a compra pede a área). */
  defaultAreaId: z
    .string()
    .refine((value) => value === "" || isUuid(value), "Área inválida.")
    .transform((value) => (value === "" ? null : value)),
});

export const purchaseSchema = z
  .object({
    // Opcional: vazia vira "Compra de DD/MM/AAAA" na gravação.
    description: singleLine("Descrição", DESCRIPTION_MAX),
    cardId: z.string({ error: "Escolha o cartão." }).refine(isUuid, "Escolha o cartão."),
    areaId: areaField,
    category: categoryField,
    notes: notesField,
    purchaseDate: civilDate("a data da compra"),
    total: amountSchema,
    count: z.string().trim(),
    firstReference: z.string().trim(),
    requestId: z.string().refine(isUuid, "Formulário inválido. Recarregue a página."),
    saveDefaultArea: z.string(),
  })
  .transform((value, ctx) => {
    const count = /^\d{1,2}$/.test(value.count) ? Number(value.count) : NaN;
    if (!Number.isInteger(count) || count < 1 || count > MAX_CARD_INSTALLMENTS) {
      ctx.addIssue({ code: "custom", path: ["count"], message: `Use de 1 a ${MAX_CARD_INSTALLMENTS} parcelas (1 = à vista).` });
    } else if (value.total < count) {
      ctx.addIssue({ code: "custom", path: ["total"], message: "Com esse total, alguma parcela ficaria com valor zero." });
    }
    let firstReference: string | null = null;
    if (value.firstReference !== "") {
      if (!/^\d{4}-\d{2}$/.test(value.firstReference)) ctx.addIssue({ code: "custom", path: ["firstReference"], message: "Fatura inválida." });
      else firstReference = value.firstReference;
    }
    return { ...value, count, firstReference };
  });

/** Edição de compra no cartão: textos e área (valor, parcelas e cartão ficam fixos). */
export const purchaseEditSchema = z.object({
  description: descriptionField,
  areaId: areaField,
  category: categoryField,
  notes: notesField,
});

/** Edição de parcela: textos, forma de pagamento e vencimento. */
export const installmentEditSchema = z.object({
  description: descriptionField,
  category: categoryField,
  notes: notesField,
  dueDate: civilDate("o vencimento"),
  paymentMethod: paymentMethodField,
});

/** Data de pagamento: válida e não posterior a hoje (São Paulo). */
export function paymentDateSchema(today: CivilDate) {
  return civilDate("a data de pagamento").refine((value) => value <= today, "A data de pagamento não pode ser futura.");
}

/** Campo → primeira mensagem de erro, para exibir junto aos campos. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}
