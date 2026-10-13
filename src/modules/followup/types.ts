import type { CivilDate } from "@/lib/dates";

export type FuPatient = {
  id: string;
  name: string;
  /** E.164 ou null. */
  phone: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  consultationCount: number;
  lastConsultDate: CivilDate | null;
  /** Etapas pendentes de acompanhamento (todas as consultas). */
  pendingSteps: number;
  /** Próxima consulta agendada (em aberto), se houver. */
  nextAppointment: { id: string; date: CivilDate; time: string | null } | null;
  /** Acompanhamento ativo mais recente (para o indicador de prazo na lista). */
  latestPlan: { consultDate: CivilDate; durationDays: number | null; noticeDays: number | null } | null;
};

/** Próxima consulta agendada: compromisso futuro, não é consulta realizada. */
export type FuAppointment = {
  id: string;
  patientId: string;
  /** Acompanhamento de origem, se houver. */
  planId: string | null;
  date: CivilDate;
  /** "HH:MM" ou null. */
  time: string | null;
  status: "agendada" | "realizada" | "cancelada";
  /** Consulta registrada na confirmação do atendimento. */
  consultationId: string | null;
  canceledAt: string | null;
  confirmedAt: string | null;
};

/** Acompanhamento ativo com prazo, para os avisos de término (central e dashboard). Sem dados clínicos. */
export type FuPlanDeadline = {
  planId: string;
  patientId: string;
  patientName: string;
  patientArchived: boolean;
  consultationId: string;
  consultDate: CivilDate;
  durationDays: number;
  noticeDays: number;
  nextAppointment: { date: CivilDate; time: string | null } | null;
};

export type FuConsultation = {
  id: string;
  patientId: string;
  consultDate: CivilDate;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FuTemplateStep = { dayOffset: number; message: string; position: number };

export type FuTemplate = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  archived: boolean;
  /** Duração total do acompanhamento em dias (D0 = consulta) e antecedência do aviso; null = não definidas. */
  durationDays: number | null;
  noticeDays: number | null;
  steps: FuTemplateStep[];
  /** Planos gerados a partir dele (informativo; editar não altera planos). */
  planCount: number;
};

export type FuStepStatus = "pendente" | "realizado" | "cancelado";

export type FuStep = {
  id: string;
  planId: string;
  dayOffset: number;
  /** Texto copiado do modelo (com variáveis). */
  message: string;
  /** Ajuste só desta etapa (com variáveis) ou null. */
  customMessage: string | null;
  originalDate: CivilDate;
  dueDate: CivilDate;
  rescheduled: boolean;
  status: FuStepStatus;
  /** Instante da realização em São Paulo ("AAAA-MM-DDTHH:MI"). */
  doneAt: string | null;
  doneText: string | null;
  note: string | null;
  canceledAt: string | null;
  cancelKind: "cancelado" | "substituido" | null;
  cancelReason: string | null;
};

export type FuPlan = {
  id: string;
  consultationId: string;
  patientId: string;
  templateId: string | null;
  templateName: string;
  templateVersion: number;
  status: "ativo" | "cancelado";
  canceledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  /** Cópia da duração e do aviso no momento em que o plano foi gerado (ou definidos depois, explicitamente). */
  durationDays: number | null;
  noticeDays: number | null;
  steps: FuStep[];
};

export type FuEvent = {
  id: string;
  consultationId: string | null;
  planId: string | null;
  stepId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};

/** Etapa com o contexto do paciente e da consulta (central de acompanhamentos). */
export type FuCentralStep = FuStep & {
  patientId: string;
  patientName: string;
  patientArchived: boolean;
  consultationId: string;
  consultDate: CivilDate;
  planStatus: "ativo" | "cancelado";
};
