import { addDays, type CivilDate } from "@/lib/dates";

/**
 * Regras puras dos planos de acompanhamento (usadas na prévia do navegador, no servidor e nos testes).
 * Datas por DIAS CORRIDOS sobre datas civis (addDays), sem milissegundos nem fuso.
 */

export type StepStatus = "pendente" | "realizado" | "cancelado";

/** Data prevista de uma etapa: consulta + intervalo. Ex.: 28/09 + D7 = 05/10. */
export const stepDate = (consultDate: CivilDate, dayOffset: number): CivilDate => addDays(consultDate, dayOffset);

export type TemplateStepLike = { dayOffset: number; message: string };

/** Etapas geradas a partir do modelo, em ordem de intervalo. */
export function buildSteps(consultDate: CivilDate, steps: TemplateStepLike[]) {
  return [...steps]
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map((s) => ({ dayOffset: s.dayOffset, message: s.message, originalDate: stepDate(consultDate, s.dayOffset), dueDate: stepDate(consultDate, s.dayOffset) }));
}

export type ExistingStep = {
  id: string;
  dayOffset: number;
  status: StepStatus;
  dueDate: CivilDate;
  originalDate: CivilDate;
  /** Remarcada individualmente (não acompanha correções automáticas). */
  rescheduled: boolean;
  /** Texto ajustado só para esta etapa. */
  customized: boolean;
};

/** Etapa pendente personalizada (remarcada ou com texto ajustado) é preservada em substituições. */
export const isPersonalized = (s: ExistingStep) => s.status === "pendente" && (s.rescheduled || s.customized);

export type ReplacementPreview = {
  /** Pendentes não personalizadas: canceladas como "substituídas" (ficam no histórico). */
  remove: ExistingStep[];
  /** Realizadas e pendentes personalizadas: mantidas como estão. */
  preserve: ExistingStep[];
  /** Novas etapas do modelo cujo intervalo não está preservado. */
  add: ReturnType<typeof buildSteps>;
  /** Intervalos do modelo que não serão criados porque já existem realizados/personalizados. */
  skipped: number[];
};

/**
 * Substituir as pendentes por um modelo: nunca recria um intervalo já realizado (nem um pendente
 * personalizado); canceladas antigas não contam.
 */
export function replacementPreview(existing: ExistingStep[], consultDate: CivilDate, template: TemplateStepLike[]): ReplacementPreview {
  const preserve = existing.filter((s) => s.status === "realizado" || isPersonalized(s));
  const remove = existing.filter((s) => s.status === "pendente" && !isPersonalized(s));
  const kept = new Set(preserve.map((s) => s.dayOffset));
  const all = buildSteps(consultDate, template);
  return { remove, preserve, add: all.filter((s) => !kept.has(s.dayOffset)), skipped: all.filter((s) => kept.has(s.dayOffset)).map((s) => s.dayOffset) };
}

export type DateCorrectionPreview = {
  /** Pendentes recalculadas: nova data = nova consulta + intervalo. */
  shift: Array<ExistingStep & { newDate: CivilDate }>;
  /** Pendentes remarcadas individualmente: data mantida (exceção registrada). */
  keepRescheduled: ExistingStep[];
  /** Realizadas: datas e realização preservadas. */
  keepDone: ExistingStep[];
};

export function dateCorrectionPreview(existing: ExistingStep[], newConsultDate: CivilDate): DateCorrectionPreview {
  const pending = existing.filter((s) => s.status === "pendente");
  return {
    shift: pending.filter((s) => !s.rescheduled).map((s) => ({ ...s, newDate: stepDate(newConsultDate, s.dayOffset) })),
    keepRescheduled: pending.filter((s) => s.rescheduled),
    keepDone: existing.filter((s) => s.status === "realizado"),
  };
}

/** Atrasada = pendente com data prevista ANTES de hoje (São Paulo). Pendente para hoje não está atrasada. */
export const isOverdue = (s: { status: StepStatus; dueDate: CivilDate }, today: CivilDate) => s.status === "pendente" && s.dueDate < today;

export const CENTRAL_FILTERS = ["hoje", "atrasados", "proximos", "concluidos", "todos"] as const;
export type CentralFilter = (typeof CENTRAL_FILTERS)[number];

export const CENTRAL_FILTER_LABELS: Record<CentralFilter, string> = {
  hoje: "Hoje",
  atrasados: "Atrasados",
  proximos: "Próximos",
  concluidos: "Concluídos",
  todos: "Todos",
};

export type CentralItem = { id: string; status: StepStatus; dueDate: CivilDate; doneAt: string | null; patientName: string };

export function matchesCentralFilter(item: CentralItem, filter: CentralFilter, today: CivilDate, showCanceled: boolean): boolean {
  switch (filter) {
    case "hoje":
      return item.status === "pendente" && item.dueDate === today;
    case "atrasados":
      return isOverdue(item, today);
    case "proximos":
      return item.status === "pendente" && item.dueDate > today;
    case "concluidos":
      return item.status === "realizado";
    case "todos":
      return showCanceled || item.status !== "cancelado";
  }
}

/** Contadores sobre TODOS os registros (não só os exibidos); cancelados e realizados ficam fora. */
export function centralCounts(items: CentralItem[], today: CivilDate) {
  let hoje = 0;
  let atrasados = 0;
  let proximos = 0;
  let concluidos = 0;
  for (const i of items) {
    if (i.status === "realizado") concluidos++;
    if (i.status !== "pendente") continue;
    if (i.dueDate === today) hoje++;
    else if (i.dueDate < today) atrasados++;
    else proximos++;
  }
  return { hoje, atrasados, proximos, concluidos };
}

/**
 * Ordenação: concluídos pela realização (mais recentes primeiro); demais pela data prevista
 * (mais antigas primeiro). Desempate estável por paciente e id.
 */
export function sortCentral<T extends CentralItem>(items: T[], filter: CentralFilter): T[] {
  const tie = (a: T, b: T) => a.patientName.localeCompare(b.patientName, "pt-BR") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...items].sort((a, b) => {
    if (filter === "concluidos") return (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || tie(a, b);
    return a.dueDate.localeCompare(b.dueDate) || tie(a, b);
  });
}
