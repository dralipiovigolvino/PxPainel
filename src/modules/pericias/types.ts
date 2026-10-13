import type { CivilDate } from "@/lib/dates";

export type PerCompany = {
  id: string;
  name: string;
  /** Valor padrão por perícia (copiado para cada perícia nova). */
  defaultAmountCents: number;
  /** CNPJ pelo qual as perícias desta empresa são recebidas (padrão das novas); null = sem CNPJ. */
  cnpjId: string | null;
  archived: boolean;
  /** Perícias vinculadas (impedem a exclusão). */
  links: number;
};

export type PerExamStatus = "agendada" | "realizada" | "cancelada";

export type PerExam = {
  id: string;
  companyId: string;
  companyName: string;
  date: CivilDate;
  /** "HH:MM". */
  time: string;
  /** Valor desta perícia. */
  amountCents: number;
  /** CNPJ pelo qual esta perícia é recebida; null = sem CNPJ (nenhum imposto estimado). */
  cnpjId: string | null;
  /** Alíquota de imposto estimado gravada nesta perícia (pontos-base); 0 sem CNPJ. */
  taxRateBp: number;
  notes: string | null;
  status: PerExamStatus;
  doneAt: string | null;
  canceledAt: string | null;
  receivedOn: CivilDate | null;
};

export type PerEvent = { id: string; examId: string | null; action: string; details: Record<string, unknown>; createdAt: string };
