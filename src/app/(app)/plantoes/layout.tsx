import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/plantoes", label: "Calendário" },
  { href: "/plantoes/organizacao", label: "Organização" },
] as const;

export default function PlantoesLayout({ children }: LayoutProps<"/plantoes">) {
  return (
    <>
      <PageHeader title="Plantões" />
      <SectionTabs label="Seções de Plantões" tabs={TABS} />
      {children}
    </>
  );
}
