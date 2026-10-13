import { addDays, daysBetween, formatCivilDate, type CivilDate } from "@/lib/dates";

/**
 * Prazo do acompanhamento (regras puras). A consulta é D0; um acompanhamento de 45 dias termina em
 * consulta + 45 dias. O aviso começa `noticeDays` antes do término.
 * O prazo é só um indicador: não realiza, cancela nem esconde etapas.
 */
export const DEFAULT_NOTICE_DAYS = 7;
export const MAX_DURATION_DAYS = 3650;

export type DeadlineState = "sem_prazo" | "em_acompanhamento" | "perto_de_encerrar" | "termina_hoje" | "encerrado";

export type Deadline = {
  state: DeadlineState;
  /** Data de término (consulta + duração); null sem duração definida. */
  endDate: CivilDate | null;
  /** Dias até o término (0 = hoje; negativo = já passou); null sem duração. */
  daysLeft: number | null;
};

export const endDateOf = (consultDate: CivilDate, durationDays: number): CivilDate => addDays(consultDate, durationDays);

export function planDeadline(consultDate: CivilDate, durationDays: number | null, noticeDays: number | null, today: CivilDate): Deadline {
  if (durationDays === null) return { state: "sem_prazo", endDate: null, daysLeft: null };
  const endDate = endDateOf(consultDate, durationDays);
  const daysLeft = daysBetween(today, endDate);
  const state: DeadlineState = daysLeft < 0 ? "encerrado" : daysLeft === 0 ? "termina_hoje" : daysLeft <= (noticeDays ?? DEFAULT_NOTICE_DAYS) ? "perto_de_encerrar" : "em_acompanhamento";
  return { state, endDate, daysLeft };
}

export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  sem_prazo: "Sem duração definida",
  em_acompanhamento: "Em acompanhamento",
  perto_de_encerrar: "Perto de encerrar",
  termina_hoje: "Termina hoje",
  encerrado: "Prazo encerrado",
};

/** "Termina em 18/11/2026 (faltam 12 dias)", "Termina hoje (04/10/2026)", "Encerrado em 01/10/2026 (há 3 dias)". */
export function describeDeadline(d: Deadline): string {
  if (d.endDate === null || d.daysLeft === null) return "Duração não definida para este acompanhamento.";
  const date = formatCivilDate(d.endDate);
  if (d.daysLeft === 0) return `Termina hoje (${date})`;
  if (d.daysLeft > 0) return `Termina em ${date} (${d.daysLeft === 1 ? "falta 1 dia" : `faltam ${d.daysLeft} dias`})`;
  const past = -d.daysLeft;
  return `Encerrado em ${date} (${past === 1 ? "há 1 dia" : `há ${past} dias`})`;
}

export type DurationCheck = { ok: true } | { ok: false; field: "durationDays" | "noticeDays"; message: string };

/**
 * Coerência entre a duração e as etapas: a duração não pode ser menor que o último dia de etapa
 * (nenhuma etapa é removida para caber) e o aviso não pode ser maior que a duração.
 */
export function checkDuration(durationDays: number, noticeDays: number, stepOffsets: number[]): DurationCheck {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    return { ok: false, field: "durationDays", message: `Use de 1 a ${MAX_DURATION_DAYS} dias.` };
  }
  const last = stepOffsets.length ? Math.max(...stepOffsets) : 0;
  if (durationDays < last) {
    return { ok: false, field: "durationDays", message: `A duração (D${durationDays}) é menor que a última etapa (D${last}). Aumente a duração ou ajuste as etapas; nenhuma etapa é removida automaticamente.` };
  }
  if (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > durationDays) {
    return { ok: false, field: "noticeDays", message: `O aviso deve ficar entre 0 e ${durationDays} dias (a duração).` };
  }
  return { ok: true };
}

export type AppointmentLike = { status: "agendada" | "realizada" | "cancelada"; date: CivilDate; time: string | null };

/** "Próxima consulta não agendada" ou "Próxima consulta: DD/MM/AAAA às HH:MM". */
export function describeNextAppointment(a: Pick<AppointmentLike, "date" | "time"> | null): string {
  if (!a) return "Próxima consulta não agendada";
  return `Próxima consulta: ${formatCivilDate(a.date)}${a.time ? ` às ${a.time}` : ""}`;
}

/** Agendada com data já passada: é preciso confirmar se o atendimento aconteceu (nada é confirmado sozinho). */
export const needsAppointmentConfirmation = (a: Pick<AppointmentLike, "status" | "date">, today: CivilDate) => a.status === "agendada" && a.date < today;

/** Destaque: perto de encerrar, terminando hoje ou encerrado, e sem próxima consulta marcada. */
export const needsAttention = (d: Deadline, hasNextAppointment: boolean) => !hasNextAppointment && (d.state === "perto_de_encerrar" || d.state === "termina_hoje" || d.state === "encerrado");
