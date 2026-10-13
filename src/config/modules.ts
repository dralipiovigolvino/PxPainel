import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Stethoscope,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Módulos que o usuário pode reordenar e ocultar no menu. O Dashboard é fixo: sempre o primeiro. */
export const MENU_KEYS = ["financas", "followup", "plantoes", "pericias", "cnpj"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export type AppModule = {
  key: "dashboard" | MenuKey;
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Módulos exibidos na navegação, na ordem padrão do menu. */
export const APP_MODULES = [
  {
    key: "dashboard",
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "financas",
    href: "/financas",
    label: "Finanças",
    icon: Wallet,
  },
  {
    key: "followup",
    href: "/follow-up",
    label: "Follow-up",
    icon: Stethoscope,
  },
  {
    key: "plantoes",
    href: "/plantoes",
    label: "Plantões",
    icon: CalendarDays,
  },
  {
    key: "pericias",
    href: "/pericias",
    label: "Perícias",
    icon: ClipboardCheck,
  },
  {
    key: "cnpj",
    href: "/cnpj",
    label: "CNPJ",
    icon: Building2,
  },
] as const satisfies readonly AppModule[];

/** Indica se o link do módulo corresponde à rota atual, incluindo subrotas. */
export function isModuleActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Menu do usuário: a ordem dos módulos e os que ele ocultou. Ocultar só tira o módulo do menu e do
 * Dashboard; os dados continuam guardados e as telas seguem acessíveis pelo endereço.
 */
export type MenuPrefs = { order: MenuKey[]; hidden: MenuKey[] };

export const DEFAULT_MENU: MenuPrefs = { order: [...MENU_KEYS], hidden: [] };

export function isMenuKey(value: unknown): value is MenuKey {
  return typeof value === "string" && (MENU_KEYS as readonly string[]).includes(value);
}

/**
 * Preferências válidas a partir de qualquer entrada (banco ou formulário): só módulos conhecidos e sem
 * repetição. Módulo que faltar na ordem (ex.: criado depois) vai para o fim, na ordem padrão, e visível.
 */
export function normalizeMenu(order: readonly unknown[], hidden: readonly unknown[]): MenuPrefs {
  const ordered = new Set<MenuKey>(order.filter(isMenuKey));
  for (const key of MENU_KEYS) ordered.add(key);
  const hiddenKeys = new Set(hidden.filter(isMenuKey));
  return { order: [...ordered], hidden: [...ordered].filter((key) => hiddenKeys.has(key)) };
}

/** Módulos do menu na ordem do usuário, sem os ocultos. */
export function visibleMenuKeys(prefs: MenuPrefs): MenuKey[] {
  return prefs.order.filter((key) => !prefs.hidden.includes(key));
}

/** Move um módulo uma posição para cima (-1) ou para baixo (+1); nas pontas, a ordem não muda. */
export function moveMenuKey(order: readonly MenuKey[], key: MenuKey, delta: -1 | 1): MenuKey[] {
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Itens da navegação: o Dashboard e, depois, os módulos visíveis na ordem recebida. */
export function navModules(visible: readonly MenuKey[]): AppModule[] {
  return [APP_MODULES[0], ...visible.flatMap((key) => APP_MODULES.filter((m) => m.key === key))];
}
