import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterChip = { key: string; href: string; label: string; active: boolean; /** Cor de identidade (ex.: área). */ dot?: string };

/** Filtro de uma escolha só, em botões (links). Mantém os demais filtros na URL de cada opção. */
export function FilterChips({ label, items, className }: { label: string; items: FilterChip[]; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.active ? "true" : undefined}
              data-chip={item.key}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.dot && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full ring-1 ring-white/70" style={{ backgroundColor: item.dot }} />}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
