"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser } from "@/lib/auth/session";
import { formatCivilDate, parseYearMonth, todayInSaoPaulo } from "@/lib/dates";
import type { ActionState } from "./actions";
import {
  createCard,
  createPurchase,
  deleteCard,
  deletePurchase,
  isReasonableFirstReference,
  payInvoice,
  previewPurchase,
  setCardArchived,
  setInvoiceTotal,
  unpayInvoice,
  updateCard,
  updatePurchase,
  type InvoiceTarget,
  type PurchasePreview,
} from "./cards-data";
import type { FailureReason, MutationResult } from "./data";
import { isUuid } from "./domain/filters";
import { cardSchema, fieldErrors, optionalAmountSchema, paymentDateSchema, purchaseEditSchema, purchaseSchema } from "./domain/schemas";

const FAILURES: Partial<Record<FailureReason, string>> = {
  not_found: "Registro não encontrado. Atualize a página.",
  duplicate_name: "Já existe um cartão com esse nome.",
  area_archived: "A área escolhida está arquivada. Escolha uma área ativa.",
  invalid_area: "Área inválida. Escolha uma das suas áreas ativas.",
  has_entries: "Este cartão tem compras ou faturas e não pode ser excluído. Arquive-o em vez disso.",
  invoice_paid: "Esse mês do cartão já está pago. Volte o cartão para a pagar ou escolha outro mês para a 1ª parcela.",
  invoice_empty: "Informe o total da fatura para marcar como paga.",
  card_archived: "O cartão está arquivado e não recebe novas compras.",
  invalid_card: "Cartão inválido. Escolha um dos seus cartões ativos.",
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** `failures`: mensagens próprias da operação (o mesmo motivo pede orientações diferentes em cada tela). */
function done(result: MutationResult, message: string, values?: Record<string, string>, failures: Partial<Record<FailureReason, string>> = {}): ActionState {
  if (!result.ok) {
    const byField: Partial<Record<FailureReason, Record<string, string>>> = {
      duplicate_name: { name: FAILURES.duplicate_name! },
      area_archived: { areaId: FAILURES.area_archived! },
      invalid_area: values && "defaultAreaId" in values ? { defaultAreaId: FAILURES.invalid_area! } : { areaId: FAILURES.invalid_area! },
      card_archived: { cardId: FAILURES.card_archived! },
      invalid_card: { cardId: FAILURES.invalid_card! },
      invoice_paid: values && "firstReference" in values ? { firstReference: FAILURES.invoice_paid! } : undefined,
    };
    return {
      status: "error",
      message: failures[result.reason] ?? FAILURES[result.reason] ?? "Não foi possível salvar agora. Tente novamente.",
      fieldErrors: byField[result.reason],
      values,
    };
  }
  revalidatePath("/financas", "layout");
  revalidatePath("/"); // o dashboard lê os mesmos registros
  return { status: "success", message, nonce: Date.now() };
}

const invalidId = (): ActionState => ({ status: "error", message: "Registro inválido. Atualize a página." });

// --- Cartões ---------------------------------------------------------------

export async function saveCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), closingDay: text(formData, "closingDay"), dueDay: text(formData, "dueDay"), notes: text(formData, "notes"), defaultAreaId: text(formData, "defaultAreaId") };
  const parsed = cardSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return done(await updateCard(user, id, parsed.data), "Cartão atualizado. Parcelas já lançadas mantêm seus vencimentos.", values);
  }
  return done(await createCard(user, parsed.data), "Cartão criado.", values);
}

export async function archiveCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  return done(await setCardArchived(user, id, archive), archive ? "Cartão arquivado." : "Cartão restaurado.");
}

export async function deleteCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return done(await deleteCard(user, id), "Cartão excluído.");
}

// --- Compras ---------------------------------------------------------------

function purchaseValues(formData: FormData) {
  return {
    description: text(formData, "description"),
    cardId: text(formData, "cardId"),
    areaId: text(formData, "areaId"),
    category: text(formData, "category"),
    notes: text(formData, "notes"),
    purchaseDate: text(formData, "purchaseDate"),
    total: text(formData, "total"),
    count: text(formData, "count"),
    firstReference: text(formData, "firstReference"),
    requestId: text(formData, "requestId"),
    saveDefaultArea: text(formData, "saveDefaultArea"),
  };
}

export async function savePurchaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const values = purchaseValues(formData);
  const parsed = purchaseSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  const { total, count, saveDefaultArea, ...rest } = parsed.data;
  if (rest.firstReference && !isReasonableFirstReference(rest.purchaseDate, rest.firstReference)) {
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: { firstReference: "Escolha um mês próximo da data da compra." }, values };
  }
  const result = await createPurchase(user, { ...rest, totalCents: total, count, setDefaultArea: saveDefaultArea === "true" });
  // O aviso diz quando vence: a compra aparece no mês do vencimento (que pode ser o seguinte).
  const due = result.ok && result.firstDue ? formatCivilDate(result.firstDue) : null;
  const message = count === 1 ? `Compra lançada${due ? `. Vence em ${due}` : ""}.` : `Compra lançada em ${count} parcelas${due ? `. A 1ª vence em ${due}` : ""}.`;
  return done(result, message, values);
}

/** Prévia somente leitura das parcelas da compra (vencimentos reais dos meses já existentes do cartão). */
export async function previewPurchaseAction(input: {
  cardId: string;
  purchaseDate: string;
  total: string;
  count: string;
  firstReference: string;
}): Promise<PurchasePreview | { error: string } | null> {
  const user = await requireFreshUser();
  const parsed = purchaseSchema.safeParse({
    ...input,
    saveDefaultArea: "",
    description: "prévia",
    areaId: "00000000-0000-4000-8000-000000000000",
    category: "",
    notes: "",
    requestId: "00000000-0000-4000-8000-000000000000",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados incompletos." };
  if (parsed.data.firstReference && !isReasonableFirstReference(parsed.data.purchaseDate, parsed.data.firstReference)) {
    return { error: "Escolha um mês próximo da data da compra." };
  }
  return previewPurchase(user, {
    cardId: parsed.data.cardId,
    purchaseDate: parsed.data.purchaseDate,
    totalCents: parsed.data.total,
    count: parsed.data.count,
    firstReference: parsed.data.firstReference,
  });
}

export async function savePurchaseEditAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { description: text(formData, "description"), areaId: text(formData, "areaId"), category: text(formData, "category"), notes: text(formData, "notes") };
  const parsed = purchaseEditSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  return done(await updatePurchase(user, id, parsed.data), "Compra atualizada.", values);
}

export async function deletePurchaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return done(await deletePurchase(user, id), "Compra excluída com todas as parcelas.", undefined, {
    invoice_paid: "Esta compra tem parcela em mês já pago do cartão. Volte o cartão para a pagar antes de excluir.",
  });
}

// --- Fatura: total informado e pagamento ---------------------------------------

/** A fatura existente (invoiceId) ou, quando o cartão ainda não tem nada naquele vencimento, cartão + mês (AAAA-MM). */
function invoiceTarget(formData: FormData): InvoiceTarget | null {
  const invoiceId = text(formData, "invoiceId");
  if (invoiceId) return isUuid(invoiceId) ? { invoiceId } : null;
  const cardId = text(formData, "cardId");
  const dueMonth = parseYearMonth(text(formData, "dueMonth"));
  return isUuid(cardId) && dueMonth ? { cardId, dueMonth } : null;
}

const INVOICE_LOCKED = "Este cartão já está marcado como pago neste mês. Volte para a pagar antes de alterar o total.";

/** Total da fatura informado pelo usuário (vazio = não informado: vale a soma das compras cadastradas). */
export async function saveInvoiceTotalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const target = invoiceTarget(formData);
  if (!target) return invalidId();
  const total = text(formData, "total");
  const parsed = optionalAmountSchema.safeParse(total);
  if (!parsed.success) {
    return { status: "error", message: "Revise o total.", fieldErrors: { total: parsed.error.issues[0]?.message ?? "Valor inválido." }, values: { total } };
  }
  if (parsed.data === null && !("invoiceId" in target)) {
    return { status: "error", message: "Revise o total.", fieldErrors: { total: "Informe o total da fatura." }, values: { total } };
  }
  const result = await setInvoiceTotal(user, target, parsed.data);
  const due = result.ok && result.firstDue ? ` Vence em ${formatCivilDate(result.firstDue)}.` : "";
  const cleared = result.ok && result.count === 0 ? "Fatura removida do mês: sem total e sem compras cadastradas." : "Total removido: vale a soma das compras cadastradas.";
  return done(result, parsed.data === null ? cleared : `Total da fatura salvo.${due}`, { total }, { invoice_paid: INVOICE_LOCKED });
}

/** Marca o cartão como pago naquele vencimento: um pagamento só, pelo total confirmado no formulário ou, em branco, pela soma das compras. */
export async function payInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "invoiceId");
  if (!isUuid(id)) return invalidId();
  const values = { total: text(formData, "total"), paidOn: text(formData, "paidOn") };
  const total = optionalAmountSchema.safeParse(values.total);
  const paidOn = paymentDateSchema(todayInSaoPaulo()).safeParse(values.paidOn);
  if (!total.success || !paidOn.success) {
    const errors: Record<string, string> = {};
    if (!total.success) errors.total = total.error.issues[0]?.message ?? "Valor inválido.";
    if (!paidOn.success) errors.paidOn = paidOn.error.issues[0]?.message ?? "Data inválida.";
    return { status: "error", message: "Revise os campos destacados.", fieldErrors: errors, values };
  }
  return done(await payInvoice(user, id, paidOn.data, total.data), "Cartão marcado como pago.", values, { invoice_paid: INVOICE_LOCKED });
}

export async function unpayInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "invoiceId");
  if (!isUuid(id)) return invalidId();
  return done(await unpayInvoice(user, id), "Cartão voltou para a pagar.");
}
