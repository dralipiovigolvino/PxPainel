"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SectionTab = { href: string; label: string };

/**
 * Abas de um módulo (segmentado). A primeira aba é a raiz do módulo e só fica ativa nela mesma;
 * as demais também nas subrotas. Quebra em linhas no celular: nenhuma aba fica escondida.
 */
export function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  const pathname = usePathname();
  const root = tabs[0]?.href;
  return (
    <nav aria-label={label} className="mb-4">
      <ul className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted p-1">
        {tabs.map((tab) => {
          const active = tab.href === root ? pathname === root : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
