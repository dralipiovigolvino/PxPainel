"use client";

import { useEffect, useRef, useState } from "react";
import type { CivilDate } from "@/lib/dates";
import type { PlShift } from "../types";

/**
 * Arrastar e soltar bolinhas (sem biblioteca; eventos de ponteiro).
 * - Mouse: o arraste começa só depois de 6 px de movimento (clique continua abrindo os detalhes).
 * - Toque: exige pressionar ~350 ms; mover antes disso é rolagem (sem arraste acidental).
 * - Esc ou soltar fora de um dia cancela; a bolinha nunca muda de lugar antes da confirmação e da gravação.
 * O resultado é só um pedido (shift + nova data); a movimentação real passa pelo formulário de confirmação.
 */
export function useShiftDrag(onDrop: (shift: PlShift, date: CivilDate) => void) {
  const [drag, setDrag] = useState<{ shift: PlShift; x: number; y: number; target: CivilDate | null } | null>(null);
  const state = useRef<{ shift: PlShift; startX: number; startY: number; touch: boolean; active: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });

  useEffect(() => {
    const targetAt = (x: number, y: number): CivilDate | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("td[data-date]");
      return (el?.dataset.date as CivilDate | undefined) ?? null;
    };
    const reset = () => {
      if (state.current?.timer) clearTimeout(state.current.timer);
      state.current = null;
      setDrag(null);
    };
    const onMove = (e: PointerEvent) => {
      const s = state.current;
      if (!s) return;
      const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
      if (!s.active) {
        if (s.touch) {
          if (dist > 10) reset(); // rolagem antes do toque longo: não é arraste
          return;
        }
        if (dist < 6) return;
        s.active = true;
      }
      setDrag({ shift: s.shift, x: e.clientX, y: e.clientY, target: targetAt(e.clientX, e.clientY) });
    };
    const onUp = (e: PointerEvent) => {
      const s = state.current;
      if (!s) return;
      if (s.active) {
        const target = targetAt(e.clientX, e.clientY);
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (target && target !== s.shift.date) dropRef.current(s.shift, target);
      }
      reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.current?.active) reset();
    };
    // Durante o arraste por toque, impede a rolagem da página (listener não passivo).
    const onTouchMove = (e: TouchEvent) => {
      if (state.current?.active) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("keydown", onKey);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  /** Props para a bolinha (só ocorrências não canceladas podem ser arrastadas). */
  const dragProps = (shift: PlShift): React.HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      if (shift.status === "cancelado" || (e.pointerType === "mouse" && e.button !== 0)) return;
      const touch = e.pointerType !== "mouse";
      const s = { shift, startX: e.clientX, startY: e.clientY, touch, active: false, timer: null as ReturnType<typeof setTimeout> | null };
      if (touch) {
        s.timer = setTimeout(() => {
          if (state.current === s) {
            s.active = true;
            setDrag({ shift, x: s.startX, y: s.startY, target: null });
          }
        }, 350);
      }
      state.current = s;
    },
    onClickCapture: (e) => {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e) => {
      if (state.current?.touch) e.preventDefault();
    },
  });

  return { drag, dragProps };
}
