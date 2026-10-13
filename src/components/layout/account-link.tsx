"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export const ACCOUNT_PATH = "/minha-conta";

type AccountLinkProps = {
  label: string;
  className?: string;
};

/** Acesso a "Minha conta" exibindo, discretamente, o nome ou o e-mail. */
export function AccountLink({ label, className }: AccountLinkProps) {
  const active = usePathname() === ACCOUNT_PATH;
  return (
    <Link
      href={ACCOUNT_PATH}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <UserRound className="size-4.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        <span className="sr-only">Minha conta: </span>
        {label}
      </span>
    </Link>
  );
}
