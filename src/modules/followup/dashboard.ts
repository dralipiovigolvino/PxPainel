import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, type CivilDate } from "@/lib/dates";
import type { DashboardItem, DashboardModuleData } from "@/modules/dashboard/contract";
import { listAppointmentsToConfirm, listPlanDeadlines } from "./appointments-data";
import { describeDeadline, describeNextAppointment, needsAttention, planDeadline } from "./domain/deadline";
import { stepLabel } from "./domain/messages";
import { listCentralSteps } from "./plans-data";

/** Prazo encerrado sem próxima consulta continua no painel por este número de dias. */
export const ENDED_NOTICE_DAYS = 60;

/**
 * Follow-up no dashboard:
 * - etapas PENDENTES (atrasadas de qualquer data, hoje e até hoje + 7), inclusive de pacientes arquivados;
 * - avisos de término: acompanhamentos perto de encerrar, terminando hoje ou encerrados há até 60 dias
 *   sem próxima consulta marcada — sempre com a situação da próxima consulta;
 * - próximas consultas cuja data passou e aguardam confirmação do atendimento.
 * Só o necessário: nome do paciente, etapa/prazo e datas. Telefone, observações e mensagem não saem
 * daqui. Quem chama deve ter confirmado a sessão no servidor (requireVerifiedUser).
 */
export async function followupDashboard(user: AuthUser, today: CivilDate): Promise<DashboardModuleData> {
  const until = addDays(today, 7);
  const [steps, deadlines, toConfirm] = await Promise.all([listCentralSteps(user), listPlanDeadlines(user), listAppointmentsToConfirm(user, today)]);
  const items: DashboardItem[] = [];
  for (const s of steps) {
    if (s.status !== "pendente" || s.planStatus !== "ativo" || s.dueDate > until) continue;
    const place =
      s.dueDate < today
        ? ({ section: "atrasados", status: "atrasado" } as const)
        : s.dueDate === today
          ? ({ section: "hoje", status: "hoje" } as const)
          : ({ section: "proximos", status: "proximo" } as const);
    const base = `/follow-up/pacientes/${s.patientId}?etapa=${s.id}`;
    items.push({
      key: `followup:etapa:${s.id}`,
      source: "followup",
      type: "etapa",
      id: s.id,
      kind: "pendencia",
      ...place,
      title: s.patientName,
      detail: stepLabel(s.dayOffset),
      date: s.dueDate,
      amount: { kind: "none" },
      href: `${base}#etapa-${s.id}`,
      // As ações abrem os diálogos da página do paciente (mesmas validações e confirmações).
      actions: [
        { kind: "abrir_mensagem", href: `${base}&acao=mensagem` },
        { kind: "marcar_realizada", href: `${base}&acao=realizar` },
      ],
    });
  }

  for (const a of toConfirm) {
    items.push({
      key: `followup:agendamento:${a.id}`,
      source: "followup",
      type: "agendamento",
      id: a.id,
      kind: "aviso",
      attention: true,
      section: "prazos",
      status: "confirmar_atendimento",
      title: a.patientName,
      detail: `Próxima consulta estava marcada${a.time ? ` às ${a.time}` : ""}: confirme se aconteceu`,
      date: a.date,
      amount: { kind: "none" },
      href: `/follow-up/pacientes/${a.patientId}`,
      actions: [],
    });
  }

  for (const p of deadlines) {
    const d = planDeadline(p.consultDate, p.durationDays, p.noticeDays, today);
    const hasNext = p.nextAppointment !== null;
    const show = d.state === "perto_de_encerrar" || d.state === "termina_hoje" || (d.state === "encerrado" && !hasNext && (d.daysLeft ?? 0) >= -ENDED_NOTICE_DAYS);
    if (!show || d.endDate === null) continue;
    items.push({
      key: `followup:prazo:${p.planId}`,
      source: "followup",
      type: "prazo",
      id: p.planId,
      kind: "aviso",
      attention: needsAttention(d, hasNext),
      section: "prazos",
      status: d.state === "perto_de_encerrar" ? "perto_de_encerrar" : d.state === "termina_hoje" ? "termina_hoje" : "encerrado",
      title: p.patientName,
      detail: `${describeDeadline(d)} · ${describeNextAppointment(p.nextAppointment)}`,
      date: d.endDate,
      amount: { kind: "none" },
      href: `/follow-up/pacientes/${p.patientId}`,
      actions: [],
    });
  }
  return { source: "followup", items, coverage: { generationTarget: null, note: null } };
}
