import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { ForecastView } from "@/modules/plantoes/components/forecast-view";
import { SeriesManager } from "@/modules/plantoes/components/series-manager";
import { TypesManager } from "@/modules/plantoes/components/types-manager";
import { listTypes } from "@/modules/plantoes/data";
import { groupForecast } from "@/modules/plantoes/domain/payment";
import { listForecast } from "@/modules/plantoes/forecast-data";
import { listSeries } from "@/modules/plantoes/series-data";

export const metadata: Metadata = { title: "Plantões · Organização" };

export default async function OrganizacaoPage() {
  const user = await requireUser();
  const today = todayInSaoPaulo();
  let data;
  try {
    const [forecast, series, types, cnpjs] = await Promise.all([listForecast(user), listSeries(user), listTypes(user), listCnpjOptions(user)]);
    data = { forecast, series, types, cnpjs };
  } catch {
    return <LoadError />;
  }
  return (
    <div className="flex flex-col gap-4">
      <section id="recebimentos"><ForecastView groups={groupForecast(data.forecast.shifts, today)} today={today} withoutForecast={data.forecast.withoutForecast} /></section>
      <details id="recorrencias" className="rounded-xl border bg-card p-4 shadow-xs"><summary className="cursor-pointer font-semibold">Recorrências</summary><div className="mt-4"><SeriesManager series={data.series} types={data.types} cnpjs={data.cnpjs} today={today} /></div></details>
      <details id="tipos" className="rounded-xl border bg-card p-4 shadow-xs"><summary className="cursor-pointer font-semibold">Locais e tipos</summary><div className="mt-4"><TypesManager types={data.types} cnpjs={data.cnpjs} /></div></details>
    </div>
  );
}
