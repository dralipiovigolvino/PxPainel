"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser } from "@/lib/auth/session";
import { formatCivilDate, parseCivilDate, todayInSaoPaulo, type CivilDate } from "@/lib/dates";
import {
  createArea,
  createEntry,
  deleteArea,
  deleteEntry,
  markEntryPaid,
  markEntryPending,
  setAreaArchived,
  setOccurrenceAmount,
  updateArea,
  updateEntry,
  type FailureReason,
  type MutationResult,
} from "./data";
import { isUuid } from "./domain/filters";
import { isPaymentMethod } from "./domain/payment";
import {
  areaSchema,
  entrySchema,
  fieldErrors,
  installmentEditSchema,
  optionalAmountSchema,
  paymentDateSchema,
  planSchema,
  seriesSchema,
  variableEntrySchema,
} from "./domain/schemas";
import { cancelPendingInstallments, createInstallmentPlan, previewCancelPlan, setPlanPaymentMethod, updateInstallmentEntry } from "./installments-data";
import { createSeries, endSeries, ensureGeneratedThrough, resumeSeries, seriesImpact, splitSeries, type SeriesImpact } from "./series-data";

export type ActionState =
  | { status: "idle" }
  /** `id`: registro criado, quando o formulário de origem precisa selecioná-lo em seguida. */
  | { status: "success"; message: string; nonce: number; id?: string }
  | { status: "confirm"; message: string; count: number; nonce: number }
  | { status: "error"; message: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const FAILURES: Record<FailureReason, string> = {
  not_found: "Registro não encontrado. Atualize a página.",
  duplicate_name: "Já existe uma área com esse nome.",
  area_archived: "A área escolhida está arquivada. Escolha uma área ativa.",
  invalid_area: "Área inválida. Escolha uma das suas áreas ativas.",
  has_entries: "Esta área tem lançamentos ou recorrências e não pode ser excluída. Arquive-a em vez disso.",
  amount_unknown: "Informe o valor antes de marcar como paga.",
  needs_confirmation: "Confirme a suspensão das recorrências.",
  installment_locked: "Parcelas têm valor, área e número fixos; só a parcela pendente pode mudar de vencimento. Para mudar a estrutura, cancele as pendentes e crie um novo parcelamento.",
  nothing_to_cancel: "Não há parcelas pendentes para cancelar.",
  invoice_paid: "Esse mês do cartão já está pago. Volte o cartão para a pagar antes de alterar.",
  invoice_empty: "Informe o total da fatura para marcar como paga.",
  card_archived: "O cartão está arquivado e não recebe novas compras.",
  invalid_card: "Cartão inválido. Escolha um dos seus cartões ativos.",
  error: "Não foi possível salvar agora. Tente novamente.",
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function done(result: MutationResult, message: string, values?: Record<string, string>): ActionState {
  if (!result.ok) {
    const fieldErrorsFor: Partial<Record<FailureReason, Record<string, string>>> = {
      duplicate_name: { name: FAILURES.duplicate_name },
      area_archived: { areaId: FAILURES.area_archived },
      invalid_area: { areaId: FAILURES.invalid_area },
      amount_unknown: { amountCents: FAILURES.amount_unknown },
    };
    return { status: "error", message: FAILURES[result.reason], fieldErrors: fieldErrorsFor[result.reason], values };
  }
  revalidatePath("/financas", "layout");
  revalidatePath("/"); // o dashboard lê os mesmos registros
  return { status: "success", message, nonce: Date.now() };
}

function invalidId(): ActionState {
  return { status: "error", message: "Registro inválido. Atualize a página." };
}

/** Conta nova sempre tem forma de pagamento (só registros antigos ficam sem). */
function missingMethod(values: Record<string, string>): ActionState {
  return { status: "error", message: "Escolha a forma de pagamento.", fieldErrors: { paymentMethod: "Escolha Pix ou boleto." }, values };
}

// --- Áreas -----------------------------------------------------------------

export async function saveAreaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), color: text(formData, "color") };
  const parsed = areaSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  }
  if (id) {
    if (!isUuid(id)) return invalidId();
    return done(await updateArea(user, id, parsed.data), "Área atualizada.", values);
  }
  return done(await createArea(user, parsed.data), "Área criada.", values);
}

/**
 * Arquivar/restaurar. Com séries ativas, o primeiro envio devolve "confirm" (quantas serão
 * suspensas); o reenvio com confirmSeries=true arquiva e suspende a geração.
 */
export async function archiveAreaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  const result = await setAreaArchived(user, id, archive, text(formData, "confirmSeries") === "true");
  if (!result.ok && result.reason === "needs_confirmation") {
    const n = result.count ?? 0;
    return {
      status: "confirm",
      count: n,
      nonce: Date.now(),
      message:
        n === 1
          ? "Esta área tem 1 recorrência ativa. Ao arquivar, ela deixa de gerar novas contas (as já geradas continuam). Restaurar a área não a reativa sozinha: a retomada é feita em Recorrências, com data."
          : `Esta área tem ${n} recorrências ativas. Ao arquivar, elas deixam de gerar novas contas (as já geradas continuam). Restaurar a área não as reativa sozinhas: a retomada é feita em Recorrências, com data.`,
    };
  }
  const suspended = result.ok ? (result.count ?? 0) : 0;
  const restoredMessage =
    suspended === 0
      ? "Área restaurada."
      : `Área restaurada. ${suspended === 1 ? "1 recorrência continua suspensa" : `${suspended} recorrências continuam suspensas`} até você retomar em Recorrências.`;
  return done(result, archive ? "Área arquivada." : restoredMessage);
}

export async function deleteAreaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return done(await deleteArea(user, id), "Área excluída.");
}

// --- Lançamentos -----------------------------------------------------------

export async function saveEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = {
    description: text(formData, "description"),
    amountCents: text(formData, "amount"),
    dueDate: text(formData, "dueDate"),
    areaId: text(formData, "areaId"),
    category: text(formData, "category"),
    notes: text(formData, "notes"),
    paymentMethod: text(formData, "paymentMethod"),
  };
  // Ocorrência variável pode ficar sem valor; o banco recusa NULL em qualquer outro caso.
  const schema = id && text(formData, "variable") === "true" ? variableEntrySchema : entrySchema;
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  }
  if (id) {
    if (!isUuid(id)) return invalidId();
    return done(await updateEntry(user, id, parsed.data), "Conta atualizada.", values);
  }
  if (!parsed.data.paymentMethod) return missingMethod(values);
  return done(await createEntry(user, { ...parsed.data, amountCents: parsed.data.amountCents as number }), `Conta criada. Vence em ${formatCivilDate(parsed.data.dueDate)}.`, values);
}

export async function setAmountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const amount = text(formData, "amount");
  const parsed = optionalAmountSchema.safeParse(amount);
  if (!parsed.success) {
    return { status: "error", message: "Revise o valor.", fieldErrors: { amount: parsed.error.issues[0]?.message ?? "Valor inválido." }, values: { amount } };
  }
  return done(await setOccurrenceAmount(user, id, parsed.data), parsed.data === null ? "Valor voltou a ficar a informar." : "Valor informado.", {
    amount,
  });
}

export async function deleteEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return done(await deleteEntry(user, id), "Conta excluída.");
}

export async function payEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const paidOn = text(formData, "paidOn");
  const parsed = paymentDateSchema(todayInSaoPaulo()).safeParse(paidOn);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise a data de pagamento.",
      fieldErrors: { paidOn: parsed.error.issues[0]?.message ?? "Data inválida." },
      values: { paidOn },
    };
  }
  return done(await markEntryPaid(user, id, parsed.data), "Conta marcada como paga.", { paidOn });
}

export async function unpayEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return done(await markEntryPending(user, id), "Conta voltou para pendente.");
}

// --- Recorrências ----------------------------------------------------------

function seriesValues(formData: FormData) {
  return {
    description: text(formData, "description"),
    areaId: text(formData, "areaId"),
    category: text(formData, "category"),
    notes: text(formData, "notes"),
    amountKind: text(formData, "amountKind"),
    amount: text(formData, "amount"),
    frequency: text(formData, "frequency"),
    intervalMonths: text(formData, "intervalMonths"),
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    paymentMethod: text(formData, "paymentMethod"),
  };
}

/**
 * Cria série (sem seriesId) ou aplica nova regra a partir de "fromDate"
 * ("esta e as próximas" ou "futuras a partir de hoje").
 */
export async function saveSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const values = seriesValues(formData);
  const parsed = seriesSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  }
  const seriesId = text(formData, "seriesId");
  if (!seriesId) {
    if (!parsed.data.paymentMethod) return missingMethod(values);
    return done(await createSeries(user, parsed.data), "Recorrência criada.", values);
  }

  const fromDate = text(formData, "fromDate");
  if (!isUuid(seriesId) || !parseCivilDate(fromDate)) return invalidId();
  if (parsed.data.startDate < fromDate) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: { startDate: "A nova primeira data não pode ser anterior ao início da alteração." },
      values,
    };
  }
  return done(await splitSeries(user, seriesId, fromDate, parsed.data), "Recorrência alterada a partir da data escolhida.", values);
}

/** Prévia (somente leitura) do que uma alteração/encerramento a partir de `fromDate` afeta. */
export async function previewSeriesAction(seriesId: string, fromDate: string): Promise<SeriesImpact | null> {
  const user = await requireFreshUser();
  if (!isUuid(seriesId) || !parseCivilDate(fromDate)) return null;
  return seriesImpact(user, seriesId, fromDate);
}

export async function endSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "seriesId");
  const endDate = text(formData, "endDate");
  if (!isUuid(id)) return invalidId();
  if (!parseCivilDate(endDate)) {
    return { status: "error", message: "Revise a data.", fieldErrors: { endDate: "Data inválida." }, values: { endDate } };
  }
  return done(await endSeries(user, id, endDate), "Recorrência encerrada. Contas pagas e anteriores foram mantidas.", { endDate });
}

export async function resumeSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "seriesId");
  const fromDate = text(formData, "fromDate");
  if (!isUuid(id)) return invalidId();
  if (!parseCivilDate(fromDate)) {
    return { status: "error", message: "Revise a data.", fieldErrors: { fromDate: "Data inválida." }, values: { fromDate } };
  }
  return done(await resumeSeries(user, id, fromDate), "Recorrência retomada.", { fromDate });
}

/**
 * Geração sob demanda (operação autenticada explícita). Chamada pelo cliente depois de
 * montar a tela quando o servidor indica defasagem — nunca na renderização nem no prefetch.
 */
export async function ensureGenerationAction(target: CivilDate): Promise<{ ok: boolean; created: number }> {
  const user = await requireFreshUser();
  if (!parseCivilDate(target)) return { ok: false, created: 0 };
  try {
    const created = await ensureGeneratedThrough(user, target);
    if (created > 0) {
      revalidatePath("/financas", "layout");
      revalidatePath("/");
    }
    return { ok: true, created };
  } catch (error) {
    console.error(`[Meu Painel] financas/series.generate falhou (código ${(error as { code?: string })?.code ?? "?"})`);
    return { ok: false, created: 0 };
  }
}

// --- Parcelamentos ---------------------------------------------------------

export async function savePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const values = {
    description: text(formData, "description"),
    areaId: text(formData, "areaId"),
    category: text(formData, "category"),
    notes: text(formData, "notes"),
    total: text(formData, "total"),
    count: text(formData, "count"),
    firstDueDate: text(formData, "firstDueDate"),
    requestId: text(formData, "requestId"),
    paymentMethod: text(formData, "paymentMethod"),
  };
  const parsed = planSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  }
  if (!parsed.data.paymentMethod) return missingMethod(values);
  const { total, count, ...rest } = parsed.data;
  // Idempotente: um reenvio do mesmo formulário (mesmo requestId) confirma o MESMO plano.
  return done(await createInstallmentPlan(user, { ...rest, totalCents: total, count }), `Parcelamento criado. A 1ª parcela vence em ${formatCivilDate(rest.firstDueDate)}.`, values);
}

export async function previewCancelPlanAction(planId: string): Promise<{ count: number; cents: string } | null> {
  const user = await requireFreshUser();
  if (!isUuid(planId)) return null;
  return previewCancelPlan(user, planId);
}

export async function cancelPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "planId");
  if (!isUuid(id)) return invalidId();
  const result = await cancelPendingInstallments(user, id);
  const n = result.ok ? (result.count ?? 0) : 0;
  return done(result, n === 1 ? "1 parcela pendente cancelada. As pagas foram mantidas." : `${n} parcelas pendentes canceladas. As pagas foram mantidas.`);
}

export async function saveInstallmentEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = {
    description: text(formData, "description"),
    category: text(formData, "category"),
    notes: text(formData, "notes"),
    dueDate: text(formData, "dueDate"),
    paymentMethod: text(formData, "paymentMethod"),
  };
  const parsed = installmentEditSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  }
  return done(await updateInstallmentEntry(user, id, parsed.data), "Parcela atualizada.", values);
}

/** Forma de pagamento do parcelamento inteiro (vale para as parcelas pendentes). */
export async function planPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "planId");
  if (!isUuid(id)) return invalidId();
  const method = text(formData, "paymentMethod");
  if (!isPaymentMethod(method)) return missingMethod({ paymentMethod: method });
  const result = await setPlanPaymentMethod(user, id, method);
  const n = result.ok ? (result.count ?? 0) : 0;
  return done(result, n === 1 ? "Forma de pagamento aplicada a 1 parcela pendente." : `Forma de pagamento aplicada a ${n} parcelas pendentes.`);
}
