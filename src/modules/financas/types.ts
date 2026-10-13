import type { CivilDate } from "@/lib/dates";
import type { PaymentMethod } from "./domain/payment";
import type { EntryStatus } from "./domain/status";

export type FinArea = {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  /** Lançamentos + séries vinculados (impedem a exclusão). */
  entryCount: number;
  /** Séries ativas (arquivar a área suspende a geração delas). */
  activeSeries: number;
};

/** Tipo da obrigação fora do cartão. */
export type EntryKind = "unica" | "recorrente" | "variavel" | "parcela";

export type FinEntry = {
  id: string;
  areaId: string;
  description: string;
  /** null = valor a informar (só ocorrência variável pendente). Nunca é zero. */
  amountCents: number | null;
  dueDate: CivilDate;
  category: string | null;
  notes: string | null;
  status: EntryStatus;
  paidOn: CivilDate | null;
  seriesId: string | null;
  /** Data original da ocorrência (identidade estável); o vencimento pode ser editado. */
  occurrenceDate: CivilDate | null;
  isOverride: boolean;
  isVariable: boolean;
  installmentPlanId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  /** Pix ou boleto; null = não informada (registros antigos). */
  paymentMethod: PaymentMethod | null;
};

/** Plano de parcelamento com totais por situação (bigint serializado como texto). */
export type FinPlan = {
  id: string;
  areaId: string;
  description: string;
  category: string | null;
  totalCents: number;
  count: number;
  firstDueDate: CivilDate;
  canceled: boolean;
  paidCount: number;
  paidCents: string;
  pendingCount: number;
  /** Saldo restante. */
  pendingCents: string;
  canceledCount: number;
  canceledCents: string;
  overdueCount: number;
  nextDue: CivilDate | null;
  paymentMethod: PaymentMethod | null;
};

export function entryKind(entry: Pick<FinEntry, "seriesId" | "isVariable" | "installmentPlanId">): EntryKind {
  if (entry.installmentPlanId) return "parcela";
  if (!entry.seriesId) return "unica";
  return entry.isVariable ? "variavel" : "recorrente";
}

export type FinCard = {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number;
  /** Área sugerida nas compras deste cartão (escolhida pelo usuário); null = sem padrão. */
  defaultAreaId: string | null;
  notes: string | null;
  archived: boolean;
  /** Compras + faturas vinculadas (impedem a exclusão). */
  links: number;
};

/**
 * Parcela de uma compra no cartão, no mês em que vence (vencimento da fatura do cartão).
 * Não tem situação própria: é paga junto com a fatura (ver FinInvoice).
 */
export type CardCharge = {
  id: string;
  purchaseId: string;
  invoiceId: string;
  cardId: string;
  cardName: string;
  areaId: string;
  description: string;
  category: string | null;
  notes: string | null;
  purchaseDate: CivilDate;
  dueDate: CivilDate;
  number: number;
  count: number;
  amountCents: number;
  purchaseTotalCents: number;
};

/**
 * Fatura de um cartão num vencimento: é ela que se paga. As compras cadastradas só detalham a fatura;
 * o total que conta é o informado pelo usuário (ele não lança todas as compras) ou, sem ele, a soma delas.
 */
export type FinInvoice = {
  id: string;
  cardId: string;
  cardName: string;
  dueDate: CivilDate;
  status: "pendente" | "pago";
  paidOn: CivilDate | null;
  /** Total da fatura informado pelo usuário; null = não informado. */
  statedCents: number | null;
  /** Soma das compras cadastradas neste vencimento. */
  detailedCents: number;
  /** Valor que conta: o pago (se paga); senão o informado; senão a soma cadastrada. */
  totalCents: number;
};

export type FinSeries = {
  id: string;
  areaId: string;
  description: string;
  category: string | null;
  notes: string | null;
  amountKind: "fixo" | "variavel";
  amountCents: number | null;
  frequency: "semanal" | "quinzenal" | "mensal";
  intervalMonths: number;
  startDate: CivilDate;
  endDate: CivilDate | null;
  generatedUntil: CivilDate | null;
  suspended: boolean;
  ended: boolean;
  nextDue: CivilDate | null;
  pendingCount: number;
  paymentMethod: PaymentMethod | null;
};

export type SeriesImpact = {
  /** Pendentes geradas que serão substituídas/removidas. */
  replaceCount: number;
  replaceFrom: CivilDate | null;
  replaceTo: CivilDate | null;
  /** Pagas, personalizadas ou variáveis com valor informado: mantidas como estão. */
  preservedCount: number;
};

/** Lançamento pronto para a tela (atraso já calculado com o "hoje" de São Paulo). */
export type EntryView = FinEntry & { overdue: boolean; kind: EntryKind };
