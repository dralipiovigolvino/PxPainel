import { z } from "zod";
import { isMenuKey, normalizeMenu, type MenuPrefs } from "@/config/modules";

/** Mesmo limite da restrição do banco (char_length conta caracteres, não bytes). */
export const DISPLAY_NAME_MAX = 60;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Nome de exibição opcional. Espaços nas pontas são removidos e texto vazio
 * vira `null` ("sem nome"), que é o mesmo valor gravado no banco.
 */
export const displayNameSchema = z
  .string({ error: "Nome inválido." })
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .refine((value) => !CONTROL_CHARS.test(value), "O nome contém caracteres inválidos.")
  .refine(
    (value) => [...value].length <= DISPLAY_NAME_MAX,
    `Use no máximo ${DISPLAY_NAME_MAX} caracteres.`,
  )
  .transform((value) => (value === "" ? null : value));

export type DisplayName = z.output<typeof displayNameSchema>;

const MENU_INVALID = "Menu inválido. Recarregue a página.";

/** Lista de módulos separada por vírgula, como o formulário envia. Módulo desconhecido invalida o envio. */
const menuKeyList = z
  .string({ error: MENU_INVALID })
  .transform((value) =>
    value
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  )
  .refine((keys) => keys.every(isMenuKey), MENU_INVALID);

/** Ordem do menu e módulos ocultos; o resultado já vem normalizado (sem repetição, todos os módulos na ordem). */
export const menuSchema = z.object({ order: menuKeyList, hidden: menuKeyList }).transform(({ order, hidden }): MenuPrefs => normalizeMenu(order, hidden));
