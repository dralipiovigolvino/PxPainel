import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/follow-up", label: "Acompanhamentos" },
  { href: "/follow-up/pacientes", label: "Pacientes" },
  { href: "/follow-up/modelos", label: "Modelos" },
] as const;

export default function FollowUpLayout({ children }: LayoutProps<"/follow-up">) {
  return (
    <>
      <PageHeader title="Follow-up" />
      <SectionTabs label="Seções de Follow-up" tabs={TABS} />
      {children}
    </>
  );
}
