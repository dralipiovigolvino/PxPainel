import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { RecurrencesView } from "@/modules/financas/components/recurrences-view";
import { listAreas } from "@/modules/financas/data";
import { listPlans } from "@/modules/financas/installments-data";
import { listCategories } from "@/modules/financas/overview-data";
import { horizonDate, listSeries, needsGeneration } from "@/modules/financas/series-data";

export const metadata: Metadata = { title: "Finanças · Recorrências" };

export default async function RecorrenciasPage() {
  const user = await requireUser();
  let data;
  try {
    const horizon = horizonDate();
    const [areas, series, plans, categories, pending] = await Promise.all([listAreas(user), listSeries(user), listPlans(user), listCategories(user), needsGeneration(user, horizon)]);
    data = { areas, series, plans, categories, generationTarget: pending ? horizon : null };
  } catch {
    return <LoadError />;
  }
  return <RecurrencesView {...data} today={todayInSaoPaulo()} />;
}
