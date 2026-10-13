import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { visibleMenuKeys } from "@/config/modules";
import { requireVerifiedUser } from "@/lib/auth/session";
import { nowInSaoPaulo } from "@/lib/dates";
import { getUserPreferences } from "@/modules/conta/data";
import { buildSections } from "@/modules/dashboard/aggregate";
import { DashboardView } from "@/modules/dashboard/components/dashboard-view";
import type { DashboardModuleResult, DashboardSource } from "@/modules/dashboard/contract";
import { followupDashboard } from "@/modules/followup/dashboard";
import { periciasDashboard } from "@/modules/pericias/dashboard";
import { plantoesDashboard } from "@/modules/plantoes/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** Falha de um módulo vira "indisponível" daquela parte (registra só o código; nunca dados). */
function settle<T>(source: DashboardSource, r: PromiseSettledResult<T>): T | null {
  if (r.status === "fulfilled") return r.value;
  console.error(`[Meu Painel] dashboard/${source} indisponível (código ${(r.reason as { code?: string })?.code ?? (r.reason as Error)?.name ?? "?"})`);
  return null;
}

export default async function DashboardPage() {
  // Há dados de pacientes: a sessão é confirmada no servidor (sem o cache de 60 s), num fluxo único.
  // Falha de autenticação interrompe a página inteira (não vira "módulo indisponível").
  const user = await requireVerifiedUser();
  // Um único "agora" (São Paulo) para toda a requisição e todos os módulos.
  const now = nowInSaoPaulo();

  // Módulo que o usuário ocultou no menu fica fora do Dashboard: não é consultado nem conta como falha.
  const menu = visibleMenuKeys((await getUserPreferences()).menu);
  const shown = (source: DashboardSource) => menu.includes(source);

  const [fu, pl, per] = await Promise.allSettled([
    shown("followup") ? followupDashboard(user, now.date) : null,
    shown("plantoes") ? plantoesDashboard(user, now.date, now.minutes) : null,
    shown("pericias") ? periciasDashboard(user, now.date, now.minutes) : null,
  ]);
  const perData = settle("pericias", per);
  const fuData = settle("followup", fu);
  const plData = settle("plantoes", pl);
  const results: DashboardModuleResult[] = [];
  if (shown("followup")) results.push(fuData ? { ok: true, data: fuData } : { ok: false, source: "followup" });
  if (shown("plantoes")) results.push(plData ? { ok: true, data: plData.data } : { ok: false, source: "plantoes" });
  if (shown("pericias")) results.push(perData ? { ok: true, data: perData.data } : { ok: false, source: "pericias" });
  const built = buildSections(results);

  return (
    <>
      <PageHeader title="Dashboard" />
      <DashboardView
        today={now.date}
        sections={built.sections.map((s) => ({ section: s.section, items: s.items, summary: null }))}
        failed={built.failed}
        generation={{ financas: null, plantoes: plData?.data.coverage.generationTarget ?? null }}
        notes={built.notes}
        shiftSummary={null}
        examSummary={null}
        summaryOrder={[]}
      />
    </>
  );
}
