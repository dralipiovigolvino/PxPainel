"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser } from "@/lib/auth/session";
import { formatMonthLabel, yearMonthOf } from "@/lib/dates";
import { formatRate } from "@/lib/tax";
import type { ActionState } from "@/modules/financas/actions";
import { isUuid } from "@/modules/financas/domain/filters";
import { fieldErrors } from "@/modules/plantoes/domain/schemas";
import { createCnpj, deleteCnpj, updateCnpj, type FailureReason, type MutationResult, type RateApplied } from "./data";
import { cnpjSchema } from "./domain/schemas";

const FAILURES: Record<FailureReason, string> = {
  not_found: "CNPJ não encontrado. Atualize a página.",
  duplicate_name: "Já existe um CNPJ com esse nome.",
  has_links: "Este CNPJ está marcado em plantões, perícias, tipos de plantão ou empresas e não pode ser excluído.",
  error: "Não foi possível salvar agora. Tente novamente.",
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function finish(result: MutationResult, message: string, values?: Record<string, string>): ActionState {
  if (!result.ok) {
    const failure = FAILURES[result.reason];
    return { status: "error", message: failure, fieldErrors: result.reason === "duplicate_name" ? { name: failure } : undefined, values };
  }
  // O CNPJ aparece nos formulários de Plantões e de Perícias e nas estimativas de Finanças.
  revalidatePath("/", "layout");
  return { status: "success", message, nonce: Date.now(), id: result.id };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** O percentual mudou: diz desde quando vale e quantos registros já lançados passaram a usá-lo. */
function describeApplied(applied: RateApplied): string {
  const month = formatMonthLabel(yearMonthOf(applied.from)).split(" de ")[0].toLowerCase();
  const parts = [applied.shifts > 0 && plural(applied.shifts, "plantão", "plantões"), applied.exams > 0 && plural(applied.exams, "perícia", "perícias")].filter(Boolean);
  const count = applied.shifts + applied.exams;
  // Só perícias: feminino; com plantões (ou os dois): masculino.
  const launched = `lançad${applied.shifts === 0 ? "a" : "o"}${count === 1 ? "" : "s"}`;
  const updated = count > 0 ? ` (${parts.join(" e ")} já ${launched} ${count === 1 ? "passou" : "passaram"} a usar o novo percentual)` : "";
  return `CNPJ salvo. ${formatRate(applied.rateBp)} vale para o trabalho de ${month} em diante${updated}. Meses anteriores ficam como estavam.`;
}

export async function saveCnpjAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = { name: text(formData, "name"), abbreviation: text(formData, "abbreviation"), number: text(formData, "number"), taxRate: text(formData, "taxRate"), taxDueDay: text(formData, "taxDueDay") };
  const parsed = cnpjSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: fieldErrors(parsed.error), values };
  if (id) {
    if (!isUuid(id)) return { status: "error", message: FAILURES.not_found };
    const result = await updateCnpj(user, id, parsed.data);
    return finish(result, result.ok && result.applied ? describeApplied(result.applied) : "CNPJ salvo.", values);
  }
  return finish(await createCnpj(user, parsed.data), 'CNPJ cadastrado. Agora marque "Recebo por CNPJ" nos plantões e nas perícias.', values);
}

export async function deleteCnpjAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return { status: "error", message: FAILURES.not_found };
  return finish(await deleteCnpj(user, id), "CNPJ excluído.");
}
