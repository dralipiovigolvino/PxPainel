import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { CompaniesManager } from "@/modules/pericias/components/companies-manager";
import { listCompanies } from "@/modules/pericias/data";

export const metadata: Metadata = { title: "Perícias · Empresas" };

export default async function EmpresasPage() {
  const user = await requireUser();
  let loaded;
  try {
    const [companies, cnpjs] = await Promise.all([listCompanies(user), listCnpjOptions(user)]);
    loaded = { companies, cnpjs };
  } catch {
    return <LoadError />;
  }
  return <CompaniesManager {...loaded} />;
}
