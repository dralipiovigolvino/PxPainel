import { z } from "zod";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Regra única de senha nova (redefinição e troca). */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, `Use pelo menos ${PASSWORD_MIN} caracteres.`)
  .max(PASSWORD_MAX, `Use no máximo ${PASSWORD_MAX} caracteres.`);
