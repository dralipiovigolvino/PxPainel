import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, displayNameSchema } from "./schema";

const parse = (value: unknown) => displayNameSchema.safeParse(value);

describe("displayNameSchema", () => {
  it("remove espaços das pontas e espaços repetidos", () => {
    expect(parse("  Ana   Souza  ").data).toBe("Ana Souza");
  });

  it("trata vazio e só espaços como ausência de nome (null)", () => {
    expect(parse("").data).toBeNull();
    expect(parse("    ").data).toBeNull();
  });

  it("conta caracteres acentuados e emojis como no banco", () => {
    expect(parse("é".repeat(DISPLAY_NAME_MAX)).success).toBe(true);
    // Emoji ocupa 2 unidades UTF-16, mas é 1 caractere para o Postgres.
    expect(parse("🙂".repeat(DISPLAY_NAME_MAX)).success).toBe(true);
    expect(parse("a".repeat(DISPLAY_NAME_MAX + 1)).success).toBe(false);
  });

  it("rejeita caracteres de controle e valores que não são texto", () => {
    expect(parse("Ana\u0000").success).toBe(false);
    expect(parse(null).success).toBe(false);
    expect(parse(42).success).toBe(false);
  });
});
