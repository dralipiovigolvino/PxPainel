import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireVerifiedUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { PatientsManager } from "@/modules/followup/components/patients-manager";
import { listPatients } from "@/modules/followup/data";

export const metadata: Metadata = { title: "Follow-up · Pacientes" };

const NOTICES: Record<string, string> = { "paciente-excluido": "Paciente excluído." };

export default async function PacientesPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  // Dados de pacientes: sessão confirmada no servidor a cada leitura (sem o cache de sessão).
  const user = await requireVerifiedUser();
  const { aviso } = await searchParams;
  let patients;
  try {
    patients = await listPatients(user);
  } catch {
    return <LoadError />;
  }
  return <PatientsManager patients={patients} today={todayInSaoPaulo()} initialNotice={aviso ? NOTICES[aviso] : undefined} />;
}
