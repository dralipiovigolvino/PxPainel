import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { ForecastView } from "@/modules/plantoes/components/forecast-view";
import { groupForecast } from "@/modules/plantoes/domain/payment";
import { listForecast } from "@/modules/plantoes/forecast-data";

export const metadata: Metadata = { title: "Plantões · Recebimentos" };

export default async function PrevisaoPage() {
  const user = await requireUser();
  const today = todayInSaoPaulo();
  let loaded;
  try {
    loaded = await listForecast(user);
  } catch {
    return <LoadError />;
  }
  return <ForecastView groups={groupForecast(loaded.shifts, today)} today={today} withoutForecast={loaded.withoutForecast} />;
}
