"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_MODULES, moveMenuKey, type MenuKey, type MenuPrefs } from "@/config/modules";
import { cn } from "@/lib/utils";
import { updateMenuAction, type SaveMenuState } from "../actions";

const initialState: SaveMenuState = { status: "idle" };

const [DASHBOARD, ...MODULES] = APP_MODULES;
const moduleOf = (key: MenuKey) => MODULES.find((m) => m.key === key)!;

/**
 * Menu do usuário: ordem dos módulos (subir/descer) e quais ficam ocultos. O Dashboard é fixo no topo.
 * As mudanças só valem depois de "Salvar menu" (uma gravação só, com a lista inteira).
 */
export function MenuForm({ initial }: { initial: MenuPrefs }) {
  const [state, formAction, pending] = useActionState(updateMenuAction, initialState);
  const [order, setOrder] = useState<MenuKey[]>(initial.order);
  const [hidden, setHidden] = useState<MenuKey[]>(initial.hidden);
  // `initial` é o que está gravado (a página é atualizada depois de salvar).
  const dirty = order.join() !== initial.order.join() || [...hidden].sort().join() !== [...initial.hidden].sort().join();
  const isError = state.status === "error";

  const toggle = (key: MenuKey) => setHidden((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  return (
    <form action={formAction} className="flex flex-col gap-3" data-menu-form="">
      <input type="hidden" name="order" value={order.join(",")} />
      <input type="hidden" name="hidden" value={hidden.join(",")} />
      <ol className="divide-y rounded-lg border" aria-label="Itens do menu">
        <li className="flex min-h-12 items-center gap-3 px-3 text-sm" data-menu-item="dashboard">
          <DASHBOARD.icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 font-medium">{DASHBOARD.label}</span>
          <span className="text-xs text-muted-foreground">sempre o primeiro</span>
        </li>
        {order.map((key, index) => {
          const { label, icon: Icon } = moduleOf(key);
          const isHidden = hidden.includes(key);
          return (
            <li key={key} className="flex min-h-12 items-center gap-1 py-1 pr-1 pl-3 text-sm" data-menu-item={key} data-hidden={isHidden ? "" : undefined}>
              <span className={cn("flex min-w-0 flex-1 items-center gap-3", isHidden && "opacity-60")}>
                <Icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{label}</span>
                {isHidden && <span className="text-xs text-muted-foreground">Oculto</span>}
              </span>
              <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" disabled={index === 0} onClick={() => setOrder(moveMenuKey(order, key, -1))} aria-label={`Subir ${label}`}>
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" disabled={index === order.length - 1} onClick={() => setOrder(moveMenuKey(order, key, 1))} aria-label={`Descer ${label}`}>
                <ChevronDown aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => toggle(key)} aria-pressed={isHidden} aria-label={isHidden ? `Mostrar ${label}` : `Ocultar ${label}`} title={isHidden ? "Mostrar no menu" : "Ocultar do menu"}>
                {isHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground">Módulo oculto sai do menu e do Dashboard. Nada é apagado.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending || !dirty} className="h-10 shrink-0 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Salvar menu"}
        </Button>
        <p id="menu-status" role={isError ? "alert" : "status"} className={cn("min-h-5 text-sm", isError ? "text-destructive" : "text-muted-foreground")}>
          {dirty && !pending ? (isError ? state.message : "Alterações ainda não salvas.") : state.status !== "idle" && !pending ? state.message : ""}
        </p>
      </div>
    </form>
  );
}
