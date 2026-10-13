import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireVerifiedUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { listAppointmentsToConfirm, listPlanDeadlines } from "@/modules/followup/appointments-data";
import { FollowupCentral } from "@/modules/followup/components/followup-central";
import { CENTRAL_FILTERS, type CentralFilter } from "@/modules/followup/domain/plan";
import { listCentralSteps } from "@/modules/followup/plans-data";
import { listPatients, listTemplates } from "@/modules/followup/data";

export const metadata: Metadata = { title: "Follow-up" };

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<{ filtro?: string; cancelados?: string }> }) {
  // Dados de pacientes: sessão confirmada no servidor (sem o cache de leitura).
  const user = await requireVerifiedUser();
  const { filtro, cancelados } = await searchParams;
  const filter: CentralFilter = (CENTRAL_FILTERS as readonly string[]).includes(filtro ?? "") ? (filtro as CentralFilter) : "hoje";
  const today = todayInSaoPaulo();
  let steps;
  let deadlines;
  let toConfirm;
  let patients;
  let templates;
  try {
    [steps, deadlines, toConfirm, patients, templates] = await Promise.all([listCentralSteps(user), listPlanDeadlines(user), listAppointmentsToConfirm(user, today), listPatients(user), listTemplates(user)]);
  } catch {
    return <LoadError />;
  }
  return <FollowupCentral steps={steps} filter={filter} showCanceled={cancelados === "1"} today={today} deadlines={deadlines} toConfirm={toConfirm} patients={patients} templates={templates} />;
}
