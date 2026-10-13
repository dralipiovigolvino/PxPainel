import { z } from "zod";
import { newPasswordField } from "@/lib/auth/password-policy";

export { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password-policy";

/** Nova senha: comprimento mínimo e confirmação idêntica. */
export const newPasswordSchema = z
  .object({
    token: z.string().min(1, "Link inválido ou expirado.").max(512, "Link inválido ou expirado."),
    password: newPasswordField,
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "As senhas não conferem.",
    path: ["confirmation"],
  });
