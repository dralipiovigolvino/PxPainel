import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { AreasManager } from "@/modules/financas/components/areas-manager";
import { listAreas } from "@/modules/financas/data";

export const metadata: Metadata = { title: "Finanças · Áreas" };

export default async function AreasPage() {
  const user = await requireUser();
  let areas;
  try {
    areas = await listAreas(user);
  } catch {
    return <LoadError />;
  }
  return <AreasManager areas={areas} />;
}
