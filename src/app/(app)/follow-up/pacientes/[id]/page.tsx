import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { requireVerifiedUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { isUuid } from "@/modules/financas/domain/filters";
import { listPatientAppointments } from "@/modules/followup/appointments-data";
import { PatientDetail } from "@/modules/followup/components/patient-detail";
import { getPatient, listTemplates } from "@/modules/followup/data";
import { getPatientFollowups } from "@/modules/followup/plans-data";

// Título genérico: o nome do paciente não vai para o título da aba nem para a URL.
export const metadata: Metadata = { title: "Follow-up · Paciente" };

export default async function PacientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etapa?: string; acao?: string }> }) {
  const { id } = await params;
  const { etapa, acao } = await searchParams;
  const openStep = isUuid(etapa) ? { stepId: etapa, panel: acao === "realizar" ? ("realizar" as const) : ("mensagem" as const) } : null;
  if (!isUuid(id)) notFound();
  const user = await requireVerifiedUser();
  let data;
  try {
    const [patient, followups, templates, appointments] = await Promise.all([getPatient(user, id), getPatientFollowups(user, id), listTemplates(user), listPatientAppointments(user, id)]);
    data = patient ? { ...patient, ...followups, templates, appointments } : null;
  } catch {
    return <LoadError />;
  }
  // Inexistente ou de outra conta (RLS): mesma resposta.
  if (!data) notFound();
  return <PatientDetail {...data} today={todayInSaoPaulo()} openStep={acao === "mensagem" || acao === "realizar" ? openStep : null} />;
}
