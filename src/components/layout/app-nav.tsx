"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isModuleActive, navModules, type MenuKey } from "@/config/modules";

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** `visible`: módulos do menu na ordem do usuário, sem os ocultos (o Dashboard vem sempre primeiro). */
type NavProps = { visible: MenuKey[] };

/** Menu lateral, exibido a partir de telas médias. */
export function SidebarNav({ visible }: NavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal">
      <ul className="flex flex-col gap-1">
        {navModules(visible).map(({ href, label, icon: Icon }) => {
          const active = isModuleActive(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                  focusRing,
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Colunas iguais para o número de itens (Dashboard + módulos visíveis). */
const COLUMNS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5", "grid-cols-6"];

/** Barra de navegação inferior, exibida no celular. */
export function BottomNav({ visible }: NavProps) {
  const pathname = usePathname();
  const modules = navModules(visible);

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgb(0_0_0/0.04)] backdrop-blur md:hidden"
    >
      {/* Até seis itens em colunas iguais; rótulos curtos cabem em 375 px. */}
      <ul className={cn("grid", COLUMNS[modules.length])}>
        {modules.map(({ href, label, icon: Icon }) => {
          const active = isModuleActive(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                  focusRing,
                  "focus-visible:ring-inset focus-visible:ring-offset-0",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-11 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary/10",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className={cn(active && "font-semibold")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
