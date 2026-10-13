import { z } from "zod";
import { newPasswordField } from "@/lib/auth/password-policy";

/** Troca de senha: exige a atual, nova diferente e confirmação idêntica. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual.").max(1024, "Senha atual inválida."),
    newPassword: newPasswordField,
    confirmation: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    message: "As senhas não conferem.",
    path: ["confirmation"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "A nova senha deve ser diferente da atual.",
    path: ["newPassword"],
  });
