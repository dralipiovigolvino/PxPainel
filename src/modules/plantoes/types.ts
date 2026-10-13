import type { CivilDate } from "@/lib/dates";
import type { AmountKind } from "@/lib/tax";
import type { Hours } from "./domain/hours";

export type PlType = {
  id: string;
  name: string;
  location: string | null;
  amountCents: number;
  /** CNPJ pelo qual os plantões deste tipo são recebidos (padrão dos novos); null = sem CNPJ. */
  cnpjId: string | null;
  /** Regra de pagamento: dia do mês SEGUINTE ao do plantão (1–31); null = sem previsão. */
  payDay: number | null;
  payMonthOffset: 0 | 1;
  color: string;
  hours: Hours;
  notes: string | null;
  archived: boolean;
  /** Ocorrências e séries vinculadas (impedem a exclusão). */
  links: number;
};

export type PlShiftStatus = "agendado" | "realizado" | "cancelado";

export type PlShift = {
  id: string;
  typeId: string;
  date: CivilDate;
  hours: Hours;
  amountCents: number;
  /** CNPJ pelo qual este plantão é recebido; null = sem CNPJ (nenhum imposto estimado). */
  cnpjId: string | null;
  /** No banco, "por CNPJ" é o valor 'bruto'; sem CNPJ, 'liquido' ou null (registro antigo). */
  amountKind: AmountKind | null;
  /** Alíquota de imposto estimado gravada na ocorrência (só por CNPJ). */
  taxRateBp: number | null;
  /** Regra de pagamento copiada do tipo (dia do mês seguinte); null = sem regra. */
  payDay: number | null;
  payMonthOffset: 0 | 1;
  /** Data PREVISTA de pagamento (não é recebimento). */
  expectedPayDate: CivilDate | null;
  /** A previsão foi ajustada manualmente nesta ocorrência (não acompanha a regra nem as movimentações). */
  expectedPayManual: boolean;
  notes: string | null;
  status: PlShiftStatus;
  canceledAt: string | null;
  /** Série de origem e data original (identidade estável), quando recorrente. */
  seriesId: string | null;
  originalDate: CivilDate | null;
  /** Alterada individualmente (preservada nas edições da série). */
  isOverride: boolean;
  /** Movida (data atual diferente da original/primeira). */
  moved: boolean;
  doneAt: string | null;
  receivedOn: CivilDate | null;
  receivedCents: number | null;
};

export type PlEvent = { id: string; shiftId: string | null; action: string; details: Record<string, unknown>; createdAt: string };
