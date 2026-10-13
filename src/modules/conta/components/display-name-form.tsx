"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updateDisplayNameAction, type SaveDisplayNameState } from "../actions";
import { DISPLAY_NAME_MAX } from "../schema";

const initialState: SaveDisplayNameState = { status: "idle" };

export function DisplayNameForm({ initialValue }: { initialValue: string }) {
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, initialState);
  const isError = state.status === "error";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="display_name">Nome de exibição</Label>
      <p id="display_name-ajuda" className="text-sm text-muted-foreground">
        Aparece no menu (opcional).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="display_name"
          name="display_name"
          type="text"
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX * 2}
          defaultValue={state.status === "error" ? state.value : initialValue}
          aria-invalid={isError || undefined}
          aria-describedby={cn("display_name-ajuda", state.status !== "idle" && "display_name-status")}
          className="h-10 bg-card"
        />
        <Button type="submit" disabled={pending} className="h-10 shrink-0 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <p
        id="display_name-status"
        role={isError ? "alert" : "status"}
        className={cn("min-h-5 text-sm", isError ? "text-destructive" : "text-muted-foreground")}
      >
        {state.status !== "idle" && !pending ? state.message : ""}
      </p>
    </form>
  );
}
