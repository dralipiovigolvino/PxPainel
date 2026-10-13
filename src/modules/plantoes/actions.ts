"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser, requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import type { ActionState } from "@/modules/financas/actions";
import { isUuid } from "@/modules/financas/domain/filters";
import {
  createShift,
  createType,
  deleteShift,
  deleteType,
  getShiftEvents,
  receiveShift,
  setShiftDone,
  undoReceipt,
  setShiftCanceled,
  updateShift,
  updateType,
  type FailureReason,
  type MutationResult,
} from "./data";
import { civilDateField, formErrors, notesField, seriesSchema, shiftSchema, typeSchema } from "./domain/schemas";
import { applyTypeRule, typeRuleImpact, type TypeRuleImpact } from "./forecast-data";
import { createSeries, endSeries, ensureGeneratedThrough, moveSeriesFrom, moveShift, resumeSeries, seriesImpact, setTypeArchivedWithSeries, splitSeries, type SeriesImpact } from "./series-data";
import type { PlEvent } from "./types";

export type { ActionState } from "@/modules/financas/actions";

const FAILURES: Record<FailureReason, string> = {
  not_found: "Registro não encontrado. Atualize a página.",
  duplicate_name: "Já existe um tipo de plantão com esse nome.",
  type_archived: "O tipo está arquivado e não recebe novos plantões. Restaure-o ou escolha outro.",
  has_links: "Este tipo tem plantões ou recorrências e não pode ser excluído. Arquive-o em vez disso.",
  locked: "Este plantão não pode ser alterado assim (cancelado, realizado ou recebido). Use as ações disponíveis nos detalhes.",
  received: "Plantão recebido: desfaça o recebimento antes de alterar o valor ou cancelar.",
  needs_confirmation: "Confirme para continuar.",
  nothing_to_do: "Nada a alterar.",
  receipt_future: "A data do recebimento não pode ser futura.",
  cnpj_not_found: "CNPJ não encontrado. Atualize a página.",
  error: "Não foi possível salvar agora. Tente novamente.",
};

const FIELD_FOR: Partial<Record<FailureReason, string>> = { duplicate_name: "name", type_archived: "typeId", received: "amount", receipt_future: "receivedOn", cnpj_not_found: "cnpjId" };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

async function finish(result: MutationResult, message: string, values?: Record<string, string>): Promise<ActionState> {
  if (!result.ok) {
    if (result.reason === "needs_confirmation") {
      return {
        status: "confirm",
        message: `Horário sobreposto a ${result.count === 1 ? "outro plantão" : `${result.count} plantões`} (${result.detail}). Confirme se é isso mesmo.`,
        count: result.count ?? 0,
        nonce: Date.now(),
      };
    }
    if (result.reason === "locked" && result.detail === "realizado") {
      return { status: "error", message: "Plantão realizado: desfaça a realização antes de cancelar (ação explícita, registrada no histórico).", values };
    }
    const field = FIELD_FOR[result.reason];
    return { status: "error", message: FAILURES[result.reason], fieldErrors: field ? { [field]: FAILURES[result.reason] } : undefined, values };
  }
  revalidatePath("/plantoes", "layout");
  revalidatePath("/"); // o dashboard lê os mesmos registros
  return { status: "success", message, nonce: Date.now() };
}

const invalidId = (): ActionState => ({ status: "error", message: "Registro inválido. Atualize a página." });

// --- Tipos -------------------------------------------------------------------

export async function saveTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const values = {
    name: text(formData, "name"),
    location: text(formData, "location"),
    amount: text(formData, "amount"),
    cnpjId: text(formData, "cnpjId"),
    payDay: text(formData, "payDay"),
    payMonthOffset: text(formData, "payMonthOffset"),
    color: text(formData, "color"),
    notes: text(formData, "notes"),
    start: text(formData, "start"),
    end: text(formData, "end"),
    nextDay: text(formData, "nextDay"),
  };
  const parsed = typeSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: formErrors(parsed.error, values), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    const result = await updateType(user, id, parsed.data);
    const ruleChanged = result.ok && result.count === 1;
    const cnpjChanged = result.ok && result.detail === "cnpj";
    const notes = [
      ruleChanged && 'A regra de pagamento mudou: plantões já criados mantêm a previsão anterior. Use "Aplicar previsão" neste tipo para ver o impacto e atualizar os futuros.',
      cnpjChanged && "A marcação de CNPJ vale para os próximos plantões; os já criados continuam como estavam (edite o plantão ou a recorrência para mudar).",
    ].filter(Boolean);
    return finish(result, `Tipo atualizado. ${notes.length > 0 ? notes.join(" ") : "Plantões já criados mantêm seus valores e horários."}`, values);
  }
  return finish(await createType(user, parsed.data), "Tipo de plantão criado.", values);
}

export async function archiveTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const archive = text(formData, "archive") === "true";
  const result = await setTypeArchivedWithSeries(user, id, archive, text(formData, "confirmSeries") === "true");
  if (!result.ok && result.reason === "needs_confirmation") {
    const n = result.count ?? 0;
    return {
      status: "confirm",
      message: `Este tipo tem ${n === 1 ? "1 recorrência ativa" : `${n} recorrências ativas`}. Arquivar suspende novas gerações; plantões já criados e recebimentos ficam como estão. Restaurar depois não retoma automaticamente.`,
      count: n,
      nonce: Date.now(),
    };
  }
  const n = result.ok ? (result.count ?? 0) : 0;
  const message = archive
    ? n > 0
      ? `Tipo arquivado. ${n === 1 ? "1 recorrência suspensa" : `${n} recorrências suspensas`}.`
      : "Tipo arquivado."
    : n > 0
      ? `Tipo restaurado. ${n === 1 ? "1 recorrência continua suspensa" : `${n} recorrências continuam suspensas`} até você retomar.`
      : "Tipo restaurado.";
  return finish(result, message);
}

export async function deleteTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await deleteType(user, id), "Tipo excluído.");
}

// --- Ocorrências -------------------------------------------------------------

function shiftValues(formData: FormData) {
  return {
    date: text(formData, "date"),
    amount: text(formData, "amount"),
    cnpjId: text(formData, "cnpjId"),
    payMode: text(formData, "payMode"),
    payDate: text(formData, "payDate"),
    payDay: text(formData, "payDay"),
    payMonthOffset: text(formData, "payMonthOffset"),
    notes: text(formData, "notes"),
    start: text(formData, "start"),
    end: text(formData, "end"),
    nextDay: text(formData, "nextDay"),
  };
}

export async function saveShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  const typeId = text(formData, "typeId");
  const requestId = text(formData, "requestId");
  const confirmOverlap = text(formData, "confirmOverlap") === "true";
  const values = { ...shiftValues(formData), typeId };
  // Edição não muda a data (use "Mover"); a validação usa a data atual enviada pelo formulário.
  const parsed = shiftSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: formErrors(parsed.error, values), values };
  if (id) {
    if (!isUuid(id)) return invalidId();
    return finish(await updateShift(user, id, { ...parsed.data, confirmOverlap }), "Plantão atualizado.", values);
  }
  if (!isUuid(typeId)) return { status: "error", message: "Escolha o tipo de plantão.", fieldErrors: { typeId: "Escolha o tipo de plantão." }, values };
  if (!isUuid(requestId)) return invalidId();
  // "Repetir semanalmente": cria uma recorrência pelo mesmo mecanismo da aba Recorrências (sem duplicar regras).
  if (text(formData, "repeat") === "true") {
    const repeat = {
      weekdays: formData.getAll("weekday").filter((v): v is string => typeof v === "string"),
      intervalWeeks: "1",
      startDate: values.date,
      until: text(formData, "until"),
      amount: values.amount,
      cnpjId: values.cnpjId,
      notes: values.notes,
      start: values.start,
      end: values.end,
      nextDay: values.nextDay,
    };
    const flatValues = { ...values, repeat: "true", weekdays: repeat.weekdays.join(","), until: repeat.until };
    if (parsed.data.expectedPayDate !== null) {
      return { status: "error", message: "Revise os campos destacados.", fieldErrors: { payDate: "Na repetição semanal a previsão segue a regra do tipo; ajuste a data em um plantão específico depois." }, values: flatValues };
    }
    const series = seriesSchema.safeParse(repeat);
    if (!series.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: formErrors(series.error, repeat), values: flatValues };
    const created = await createSeries(user, { ...series.data, typeId });
    const n = created.ok ? (created.count ?? 0) : 0;
    return finish(created, `Repetição semanal criada (${n === 1 ? "1 plantão gerado" : `${n} plantões gerados`} até o horizonte). Ela aparece em Recorrências.`, flatValues);
  }
  return finish(await createShift(user, typeId, { ...parsed.data, requestId, confirmOverlap }), "Plantão adicionado.", values);
}

export async function cancelShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const cancel = text(formData, "cancel") !== "false";
  return finish(await setShiftCanceled(user, id, cancel), cancel ? "Plantão cancelado. Ele continua no histórico e no filtro de cancelados." : "Plantão restaurado.");
}

export async function deleteShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await deleteShift(user, id), "Plantão excluído.");
}

/** Histórico de uma ocorrência (leitura). */
export async function shiftEventsAction(id: string): Promise<PlEvent[] | null> {
  const user = await requireUser();
  if (!isUuid(id)) return null;
  return getShiftEvents(user, id);
}

// --- Recorrências ------------------------------------------------------------

function seriesValues(formData: FormData) {
  return {
    weekdays: formData.getAll("weekday").filter((v): v is string => typeof v === "string"),
    intervalWeeks: text(formData, "intervalWeeks"),
    startDate: text(formData, "startDate"),
    until: text(formData, "until"),
    amount: text(formData, "amount"),
    cnpjId: text(formData, "cnpjId"),
    notes: text(formData, "notes"),
    start: text(formData, "start"),
    end: text(formData, "end"),
    nextDay: text(formData, "nextDay"),
  };
}

const flat = (v: ReturnType<typeof seriesValues>) => ({ ...v, weekdays: v.weekdays.join(",") });

export async function saveSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const seriesId = text(formData, "seriesId");
  const typeId = text(formData, "typeId");
  const values = seriesValues(formData);
  const parsed = seriesSchema.safeParse(values);
  if (!parsed.success) return { status: "error", message: "Revise os campos destacados.", fieldErrors: formErrors(parsed.error, values), values: { ...flat(values), typeId } };
  if (seriesId) {
    // Editar = dividir a partir da data escolhida ("este e os próximos" ou "futuras").
    if (!isUuid(seriesId) || !isUuid(typeId)) return invalidId();
    const fromDate = text(formData, "fromDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return invalidId();
    if (parsed.data.startDate < fromDate) return { status: "error", message: "A nova regra não pode começar antes da data escolhida.", fieldErrors: { startDate: "Use a data escolhida ou uma posterior." }, values: { ...flat(values), typeId } };
    const result = await splitSeries(user, seriesId, fromDate, { ...parsed.data, typeId });
    return finish(result, "Recorrência atualizada a partir da data escolhida. Ocorrências preservadas ficaram como estavam.", { ...flat(values), typeId });
  }
  if (!isUuid(typeId)) return { status: "error", message: "Escolha o tipo de plantão.", fieldErrors: { typeId: "Escolha o tipo de plantão." }, values: { ...flat(values), typeId } };
  const result = await createSeries(user, { ...parsed.data, typeId });
  const n = result.ok ? (result.count ?? 0) : 0;
  return finish(result, `Recorrência criada (${n === 1 ? "1 plantão gerado" : `${n} plantões gerados`} até o horizonte).`, { ...flat(values), typeId });
}

/** Prévia (leitura) do que muda ao editar/encerrar a partir de uma data. */
export async function previewSeriesAction(seriesId: string, fromDate: string, inclusive = true): Promise<SeriesImpact | null> {
  const user = await requireUser();
  if (!isUuid(seriesId) || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  return seriesImpact(user, seriesId, fromDate, inclusive);
}

export async function endSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const seriesId = text(formData, "seriesId");
  if (!isUuid(seriesId)) return invalidId();
  const parsed = civilDateField("a data final").safeParse(text(formData, "endDate"));
  if (!parsed.success) return { status: "error", message: "Revise a data.", fieldErrors: { endDate: parsed.error.issues[0].message } };
  const result = await endSeries(user, seriesId, parsed.data);
  const n = result.ok ? (result.count ?? 0) : 0;
  return finish(result, `Recorrência encerrada${n > 0 ? ` (${n === 1 ? "1 plantão futuro removido" : `${n} plantões futuros removidos`})` : ""}.`);
}

export async function resumeSeriesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const seriesId = text(formData, "seriesId");
  if (!isUuid(seriesId)) return invalidId();
  const parsed = civilDateField("a data de retomada").safeParse(text(formData, "fromDate"));
  if (!parsed.success) return { status: "error", message: "Revise a data.", fieldErrors: { fromDate: parsed.error.issues[0].message } };
  return finish(await resumeSeries(user, seriesId, parsed.data), "Recorrência retomada a partir da data escolhida.");
}

/** Geração explícita e autenticada (chamada pelo navegador depois de montar a tela; nunca na renderização). */
export async function ensurePlGenerationAction(target: string): Promise<{ ok: boolean; created: number }> {
  const user = await requireFreshUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return { ok: false, created: 0 };
  try {
    const created = await ensureGeneratedThrough(user, target);
    if (created > 0) {
      revalidatePath("/plantoes", "layout");
      revalidatePath("/");
    }
    return { ok: true, created };
  } catch (error) {
    console.error(`[Meu Painel] plantoes/series.generate falhou (código ${(error as { code?: string })?.code ?? "?"})`);
    return { ok: false, created: 0 };
  }
}

// --- Regra de pagamento do tipo -----------------------------------------------

/** Prévia (leitura) de aplicar a regra de pagamento atual do tipo aos plantões já criados. */
export async function typeRuleImpactAction(typeId: string): Promise<TypeRuleImpact | null> {
  const user = await requireUser();
  if (!isUuid(typeId)) return null;
  return typeRuleImpact(user, typeId);
}

export async function applyTypeRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const result = await applyTypeRule(user, id);
  const n = result.ok ? (result.count ?? 0) : 0;
  return finish(result, `Previsão aplicada a ${n === 1 ? "1 plantão" : `${n} plantões`}. Recebidos e previsões ajustadas manualmente ficaram como estavam.`);
}

// --- Mover / troca -----------------------------------------------------------

export async function moveShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { newDate: text(formData, "newDate"), note: text(formData, "note") };
  const date = civilDateField("a nova data").safeParse(values.newDate);
  if (!date.success) return { status: "error", message: "Revise a data.", fieldErrors: { newDate: date.error.issues[0].message }, values };
  const note = notesField.safeParse(values.note);
  if (!note.success) return { status: "error", message: "Revise a observação.", fieldErrors: { note: note.error.issues[0].message }, values };
  const scope = text(formData, "scope");
  if (scope === "proximas" || scope === "futuras") {
    const r = await moveSeriesFrom(user, id, date.data, note.data, scope);
    if (!r.ok && r.detail === "range") return { status: "error", message: "Para a recorrência, mova no máximo 6 dias (mesma semana ou vizinha). Para distâncias maiores, mova só este plantão.", values };
    return finish(r, "Recorrência movida a partir deste plantão. Ocorrências preservadas ficaram como estavam.", values);
  }
  return finish(await moveShift(user, id, date.data, note.data), "Plantão movido. A data anterior ficou registrada no histórico.", values);
}

// --- Realização e recebimento --------------------------------------------------

export async function doneShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const done = text(formData, "done") !== "false";
  return finish(await setShiftDone(user, id, done), done ? "Plantão marcado como realizado." : "Realização desfeita. O registro anterior ficou no histórico.");
}

export async function receiveShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  const values = { receivedOn: text(formData, "receivedOn") };
  const date = civilDateField("a data do recebimento").safeParse(values.receivedOn);
  if (!date.success) return { status: "error", message: "Revise a data.", fieldErrors: { receivedOn: date.error.issues[0].message }, values };
  if (date.data > todayInSaoPaulo()) return { status: "error", message: "Revise a data.", fieldErrors: { receivedOn: "A data do recebimento não pode ser futura." }, values };
  return finish(await receiveShift(user, id, date.data), "Recebimento registrado (valor integral do plantão).", values);
}

export async function undoReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireFreshUser();
  const id = text(formData, "id");
  if (!isUuid(id)) return invalidId();
  return finish(await undoReceipt(user, id), "Recebimento desfeito. O registro anterior ficou no histórico.");
}
