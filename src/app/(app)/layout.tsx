import Link from "next/link";
import { AccountLink } from "@/components/layout/account-link";
import { BottomNav, SidebarNav } from "@/components/layout/app-nav";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { APP_CONFIG } from "@/config/app";
import { visibleMenuKeys } from "@/config/modules";
import { requireUser } from "@/lib/auth/session";
import { getUserPreferences } from "@/modules/conta/data";

// Área autenticada: requireUser() valida a sessão no servidor a cada requisição.
// Páginas, leituras e ações continuam validando por conta própria.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { displayName, menu } = await getUserPreferences();
  const accountLabel = displayName ?? user.email ?? "Minha conta";
  // Menu do usuário: ordem escolhida por ele, sem os módulos que ocultou.
  const visible = visibleMenuKeys(menu);

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-2 focus:outline-ring"
      >
        Pular para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r bg-card px-4 py-6 md:flex">
        <Link
          href="/"
          className="rounded-md px-3 text-lg font-semibold tracking-tight text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {APP_CONFIG.name}
        </Link>
        <SidebarNav visible={visible} />
        <div className="mt-auto flex flex-col gap-2 border-t pt-4">
          <AccountLink label={accountLabel} className="h-10" />
          <SignOutButton className="w-full justify-start px-3" />
        </div>
      </aside>

      {/* Cabeçalho do celular: acesso à conta sem ocupar a barra inferior. */}
      <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b bg-card/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <Link
          href="/"
          className="shrink-0 rounded-md font-semibold tracking-tight text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {APP_CONFIG.name}
        </Link>
        <AccountLink label={accountLabel} className="h-10 max-w-[60%]" />
      </header>

      <main
        id="conteudo"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none sm:px-6 md:px-8 md:py-8"
      >
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <BottomNav visible={visible} />
    </div>
  );
}
