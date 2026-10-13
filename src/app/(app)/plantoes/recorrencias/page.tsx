import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { SeriesManager } from "@/modules/plantoes/components/series-manager";
import { listTypes } from "@/modules/plantoes/data";
import { listSeries } from "@/modules/plantoes/series-data";

export const metadata: Metadata = { title: "Plantões · Recorrências" };

export default async function RecorrenciasPage() {
  const user = await requireUser();
  let data;
  try {
    const [series, types, cnpjs] = await Promise.all([listSeries(user), listTypes(user), listCnpjOptions(user)]);
    data = { series, types, cnpjs };
  } catch {
    return <LoadError />;
  }
  return <SeriesManager {...data} today={todayInSaoPaulo()} />;
}
