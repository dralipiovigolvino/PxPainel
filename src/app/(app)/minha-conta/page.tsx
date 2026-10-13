import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/modules/conta/components/change-password-form";
import { DisplayNameForm } from "@/modules/conta/components/display-name-form";
import { MenuForm } from "@/modules/conta/components/menu-form";
import { getUserPreferences } from "@/modules/conta/data";

export const metadata: Metadata = { title: "Minha conta" };

export default async function MinhaContaPage() {
  const user = await requireUser();
  const { displayName, menu } = await getUserPreferences();

  return (
    <>
      <PageHeader title="Minha conta" />

      <div className="grid max-w-2xl gap-4">
        <SectionCard id="perfil" title="Perfil">
          <dl className="mb-5 text-sm">
            <dt className="text-muted-foreground">E-mail de acesso</dt>
            <dd className="mt-0.5 font-medium break-all">{user.email ?? "—"}</dd>
          </dl>
          <DisplayNameForm initialValue={displayName ?? ""} />
        </SectionCard>

        <SectionCard id="menu" title="Menu">
          <MenuForm initial={menu} />
        </SectionCard>

        <SectionCard id="senha" title="Senha">
          <ChangePasswordForm />
        </SectionCard>

        <SectionCard id="sessao" title="Sessão">
          <SignOutButton />
        </SectionCard>
      </div>
    </>
  );
}
