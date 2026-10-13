import { addDays, type CivilDate } from "@/lib/dates";
import type { DashboardItem, DashboardModuleResult, DashboardSection, DashboardSource } from "./contract";

/** "Próximos 7 dias" = de amanhã até hoje + 7, inclusive. */
export const nextDaysRange = (today: CivilDate) => ({ from: addDays(today, 1), to: addDays(today, 7) });

export const SECTION_ORDER: DashboardSection[] = ["hoje", "atrasados", "proximos", "a_confirmar", "prazos"];
const SOURCE_ORDER: Record<DashboardSource, number> = { financas: 0, followup: 1, plantoes: 2, pericias: 3 };
const TYPE_ORDER = { conta: 0, fatura: 1, etapa: 2, agendamento: 3, prazo: 4, plantao: 5, pericia: 6 } as const;

/** Ordenação estável: data (mais antiga primeiro), depois módulo, tipo e identificador. */
export function compareItems(a: DashboardItem, b: DashboardItem): number {
  return (
    a.date.localeCompare(b.date) ||
    SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    a.title.localeCompare(b.title, "pt-BR") ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Contagem por natureza dentro de uma seção (sobre o conjunto COMPLETO, não só o exibido). */
export type SectionSummary = {
  total: number;
  /** Contas + faturas: quantidade, total conhecido (centavos) e quantos sem valor. */
  payments: { count: number; knownCents: bigint; unknownCount: number };
  followups: number;
  shifts: number;
  exams: number;
  /** Avisos de acompanhamento (prazos e atendimentos a confirmar) e quantos pedem ação. */
  notices: number;
  attention: number;
};

export function summarize(items: DashboardItem[]): SectionSummary {
  const s: SectionSummary = { total: items.length, payments: { count: 0, knownCents: 0n, unknownCount: 0 }, followups: 0, shifts: 0, exams: 0, notices: 0, attention: 0 };
  for (const i of items) {
    if (i.source === "financas") {
      s.payments.count++;
      if (i.amount.kind === "known") s.payments.knownCents += BigInt(i.amount.cents);
      else if (i.amount.kind === "unknown") s.payments.unknownCount++;
    } else if (i.kind === "aviso") {
      s.notices++;
      if (i.attention) s.attention++;
    } else if (i.source === "followup") s.followups++;
    else if (i.source === "pericias") s.exams++;
    else s.shifts++;
  }
  return s;
}

export type DashboardSectionView = { section: DashboardSection; items: DashboardItem[]; summary: SectionSummary };

/**
 * Junta os itens dos módulos disponíveis por seção. Itens de módulos que falharam não entram
 * (a interface mostra a falha daquela parte; ausência de itens ≠ "nenhuma pendência").
 */
export function buildSections(results: DashboardModuleResult[]): { sections: DashboardSectionView[]; failed: DashboardSource[]; pendingGeneration: boolean; notes: string[] } {
  const items: DashboardItem[] = [];
  const failed: DashboardSource[] = [];
  let pendingGeneration = false;
  const notes: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      failed.push(r.source);
      continue;
    }
    items.push(...r.data.items);
    if (r.data.coverage.generationTarget) pendingGeneration = true;
    if (r.data.coverage.note) notes.push(r.data.coverage.note);
  }
  const sections = SECTION_ORDER.map((section) => {
    const list = items.filter((i) => i.section === section).sort(compareItems);
    return { section, items: list, summary: summarize(list) };
  });
  return { sections, failed, pendingGeneration, notes };
}

/**
 * Resumo de uma seção (conjunto completo): só o valor a pagar das contas, com quantas estão sem valor
 * (nunca "a informar" como zero). A quantidade de itens já aparece no título da seção.
 */
export function describeSummary(s: SectionSummary, formatCents: (c: bigint) => string): string | null {
  const p = s.payments;
  if (p.count === 0) return null;
  const known = p.count - p.unknownCount;
  const unknown = p.unknownCount === 1 ? "1 sem valor" : `${p.unknownCount} sem valor`;
  if (known === 0) return unknown;
  return p.unknownCount === 0 ? `${formatCents(p.knownCents)} a pagar` : `${formatCents(p.knownCents)} a pagar + ${unknown}`;
}
