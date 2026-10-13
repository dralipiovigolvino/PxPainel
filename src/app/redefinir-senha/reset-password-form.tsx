"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { resetPasswordAction, type ResetPasswordState } from "./actions";
import { PASSWORD_MAX, PASSWORD_MIN } from "./schema";

const initialState: ResetPasswordState = { status: "idle" };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const error = state.status === "error" ? state.message : null;
  const describedBy = error ? "senha-ajuda redefinir-erro" : "senha-ajuda";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Nova senha</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
        <p id="senha-ajuda" className="text-sm text-muted-foreground">
          Mínimo de {PASSWORD_MIN} caracteres. Prefira uma senha gerada pelo seu gerenciador de senhas.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">Confirme a nova senha</Label>
        <PasswordInput
          id="confirmation"
          name="confirmation"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX}
          aria-describedby={error ? "redefinir-erro" : undefined}
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error && (
        <p
          id="redefinir-erro"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="h-11 text-sm">
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            Salvando…
          </>
        ) : (
          "Definir senha"
        )}
      </Button>
    </form>
  );
}
