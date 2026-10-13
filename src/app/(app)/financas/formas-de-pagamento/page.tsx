import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { listCards } from "@/modules/financas/cards-data";
import { CardsManager } from "@/modules/financas/components/cards-manager";
import { listAreas } from "@/modules/financas/data";

export const metadata: Metadata = { title: "Finanças · Formas de pagamento" };

export default async function FormasDePagamentoPage({ searchParams }: PageProps<"/financas/formas-de-pagamento">) {
  const { novo } = await searchParams;
  const user = await requireUser();
  let data;
  try {
    const [cards, areas] = await Promise.all([listCards(user), listAreas(user)]);
    data = { cards, areas };
  } catch {
    return <LoadError />;
  }
  return <CardsManager {...data} openNewCard={novo === "1"} />;
}
