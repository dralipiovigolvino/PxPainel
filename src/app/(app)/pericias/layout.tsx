import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/pericias", label: "Agenda" },
  { href: "/pericias/empresas", label: "Empresas" },
] as const;

export default function PericiasLayout({ children }: LayoutProps<"/pericias">) {
  return (
    <>
      <PageHeader title="Perícias" />
      <SectionTabs label="Seções de Perícias" tabs={TABS} />
      {children}
    </>
  );
}
