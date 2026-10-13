import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { TypesManager } from "@/modules/plantoes/components/types-manager";
import { listTypes } from "@/modules/plantoes/data";

export const metadata: Metadata = { title: "Plantões · Tipos" };

export default async function TiposPage() {
  const user = await requireUser();
  let loaded;
  try {
    const [types, cnpjs] = await Promise.all([listTypes(user), listCnpjOptions(user)]);
    loaded = { types, cnpjs };
  } catch {
    return <LoadError />;
  }
  return <TypesManager {...loaded} />;
}
