"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser, requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import type { ActionState } from "@/modules/financas/actions";
import { isUuid } from "@/modules/financas/domain/filters";
import { civilDateField } from "@/modules/plantoes/domain/schemas";
import {
  createCompany,
  createExam,
  deleteCompany,
  deleteExam,
  getExamEvents,
  receiveExam,
  setCompanyArchived,
  setExamCanceled,
  setExamDone,
  undoExamReceipt,
  updateCompany,
  updateExam,
  type FailureReason,
  type MutationResult,
} from "./data";
import { companySchema, examSchema, fieldErrors } from "./domain/schemas";
import type { PerEvent } from "./types";

const FAILURES: Record<FailureReason, string> = {
  not_found: "Registro não encontrado. Atualize a página.",
  duplicate_name: "Já existe uma empresa com esse nome.",
  company_archived: "A empresa está arquivada e não recebe novas perícias. Restaure-a ou escolha outra.",
  has_links: "Esta empresa tem perícias e não pode ser excluída. Arquive-a em vez disso.",
  locked: "Esta perícia não pode ser alterada assim (cancelada, realizada ou recebida). Use as ações disponíveis nos detalhes.",
  received: "Perícia com recebimento registrado: desfaça o recebimento antes de alterar o valor ou cancelar.",
  nothing_to_do: "Nada a alterar.",
  receipt_future: "A data do recebimento não pode ser futura.",
  cnpj_not_found: "CNPJ não encontrado. Atualize a página.",
  error: "Não foi possível salvar agora. Tente novamente.",
};

const FIELD_FOR: Partial<Record<FailureReason, string>> = { duplicate_name: "name", company_archived: "companyId", received: "amount", receipt_future: "receivedOn", cnpj_not_found: "cnpjId" };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function finish(result: MutationResult, message: string, values?: Record<string, string>): ActionState {
  if (!result.ok) {
    if (result.reason === "locked" && result.detail === "realizada") {
      return { status: "error", message: "Perícia realizada: desfaça a realização antes de cancelar (ação explícita, registrada no histórico).", values };
    }
    const field = FIELD_FOR[result.reason];
    return { status: "error", message: FAILURES[result.reason], fieldErrors: field ? { [field]: FAILURES[result.reason] } : undefined, values };
  }
  revalidatePath("/pericias", "layout");
  revalidatePath("/"); // o dashboard lê os mesmos registros
  return { status: "success", message, nonce: Date.now(), id: result.id };
}

const invalidId = (): ActionState => ({ status: "error", message: "Registro inválido. Atualize a página." });

// --- Empresas ------------------------------------------------------------------

export async function saveCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), amount: text(formData, "amount"), cnpjId: text(formData, "cnpjId") };
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await updateCompany(user, id, parsed.data), "Empresa atualizada. Perícias já cadastradas continuam como estavam.", values);
  }
  return finish(await createCompany(user, parsed.data), "Empresa cadastrada.", values);
}

export async function archiveCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  return finish(await setCompanyArchived(user, id, archive), archive ? "Empresa arquivada. As perícias dela continuam na agenda." : "Empresa restaurada.");
}

export async function deleteCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await deleteCompany(user, id), "Empresa excluída.");
}

// --- Perícias ------------------------------------------------------------------

export async function saveExamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const requestId = text(formData, "requestId");
  const values = { companyId: text(formData, "companyId"), date: text(formData, "date"), time: text(formData, "time"), amount: text(formData, "amount"), cnpjId: text(formData, "cnpjId"), notes: text(formData, "notes") };
  const parsed = examSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await updateExam(user, id, parsed.data), "Perícia atualizada.", values);
  }
  if (!isUuid(requestId)) return invalidId();
  return finish(await createExam(user, { ...parsed.data, requestId }), "Perícia agendada. Cadastrar não confirma realização nem recebimento.", values);
}

export async function doneExamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const done = text(formData, "done") !== "false";
  return finish(await setExamDone(user, id, done), done ? "Perícia marcada como realizada." : "Realização desfeita. O registro anterior ficou no histórico.");
}

export async function cancelExamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const cancel = text(formData, "cancel") !== "false";
  return finish(await setExamCanceled(user, id, cancel), cancel ? "Perícia cancelada. Ela sai dos totais e continua no histórico." : "Perícia restaurada.");
}

export async function deleteExamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await deleteExam(user, id), "Perícia excluída.");
}

export async function receiveExamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { receivedOn: text(formData, "receivedOn") };
  const date = civilDateField("a data do recebimento").safeParse(values.receivedOn);
  if (!date.success) return { status: "error", message: "Revise a data.", fieldErrors: { receivedOn: date.error.issues[0].message }, values };
  if (date.data > todayInSaoPaulo()) return { status: "error", message: "Revise a data.", fieldErrors: { receivedOn: "A data do recebimento não pode ser futura." }, values };
  return finish(await receiveExam(user, id, date.data), "Recebimento registrado.", values);
}

export async function undoExamReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await undoExamReceipt(user, id), "Recebimento desfeito. O registro anterior ficou no histórico.");
}

/** Histórico de uma perícia (leitura). */
export async function examEventsAction(id: string): Promise<PerEvent[] | null> {
  const user = await requireUser();
  if (!isUuid(id)) return null;
  return getExamEvents(user, id);
}
