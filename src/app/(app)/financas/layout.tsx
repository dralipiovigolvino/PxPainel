import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/financas", label: "Visão geral" },
  { href: "/financas/mes", label: "Mês" },
  { href: "/financas/recorrencias", label: "Recorrências" },
  { href: "/financas/formas-de-pagamento", label: "Formas de pagamento" },
  { href: "/financas/areas", label: "Áreas" },
] as const;

export default function FinancasLayout({ children }: LayoutProps<"/financas">) {
  return (
    <>
      <PageHeader title="Finanças" />
      <SectionTabs label="Seções de Finanças" tabs={TABS} />
      {children}
    </>
  );
}
