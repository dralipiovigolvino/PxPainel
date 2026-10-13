import { describe, expect, it } from "vitest";
import { menuSchema } from "@/modules/conta/schema";
import { APP_MODULES, DEFAULT_MENU, MENU_KEYS, moveMenuKey, navModules, normalizeMenu, visibleMenuKeys } from "./modules";

describe("menu do usuário: ordem e módulos ocultos", () => {
  it("sem preferência gravada (listas vazias) vale o menu padrão, com tudo visível", () => {
    expect(normalizeMenu([], [])).toEqual(DEFAULT_MENU);
    expect(visibleMenuKeys(DEFAULT_MENU)).toEqual(["financas", "followup", "plantoes", "pericias", "cnpj"]);
  });

  it("respeita a ordem escolhida e tira os ocultos do menu", () => {
    const menu = normalizeMenu(["cnpj", "plantoes", "financas", "pericias", "followup"], ["pericias"]);
    expect(menu).toEqual({ order: ["cnpj", "plantoes", "financas", "pericias", "followup"], hidden: ["pericias"] });
    expect(visibleMenuKeys(menu)).toEqual(["cnpj", "plantoes", "financas", "followup"]);
  });

  it("ignora módulo desconhecido e repetido; o que faltar na ordem vai para o fim, visível", () => {
    const menu = normalizeMenu(["plantoes", "dashboard", "plantoes", 7, "financas"], ["x", "plantoes", "plantoes"]);
    expect(menu).toEqual({ order: ["plantoes", "financas", "followup", "pericias", "cnpj"], hidden: ["plantoes"] });
  });

  it("ordem gravada antes de existir um módulo: o módulo novo entra no fim, visível", () => {
    const menu = normalizeMenu(["pericias", "plantoes", "followup", "financas"], ["followup"]);
    expect(menu).toEqual({ order: ["pericias", "plantoes", "followup", "financas", "cnpj"], hidden: ["followup"] });
    expect(visibleMenuKeys(menu)).toEqual(["pericias", "plantoes", "financas", "cnpj"]);
  });

  it("dá para ocultar todos os módulos: sobra só o Dashboard", () => {
    const menu = normalizeMenu([], [...MENU_KEYS]);
    expect(visibleMenuKeys(menu)).toEqual([]);
    expect(navModules(visibleMenuKeys(menu)).map((m) => m.key)).toEqual(["dashboard"]);
  });

  it("subir e descer trocam com o vizinho; nas pontas nada muda", () => {
    const order = [...MENU_KEYS];
    expect(moveMenuKey(order, "plantoes", -1)).toEqual(["financas", "plantoes", "followup", "pericias", "cnpj"]);
    expect(moveMenuKey(order, "plantoes", 1)).toEqual(["financas", "followup", "pericias", "plantoes", "cnpj"]);
    expect(moveMenuKey(order, "financas", -1)).toEqual(order);
    expect(moveMenuKey(order, "cnpj", 1)).toEqual(order);
    expect(order).toEqual([...MENU_KEYS]); // a lista original não é alterada
  });

  it("navegação: Dashboard sempre primeiro, depois os visíveis na ordem do usuário", () => {
    expect(navModules(["pericias", "financas"]).map((m) => m.href)).toEqual(["/", "/pericias", "/financas"]);
    expect(navModules([...MENU_KEYS])).toEqual([...APP_MODULES]);
  });
});

describe("formulário do menu", () => {
  it("aceita listas separadas por vírgula e devolve o menu normalizado", () => {
    expect(menuSchema.parse({ order: "pericias,financas", hidden: "followup" })).toEqual({
      order: ["pericias", "financas", "followup", "plantoes", "cnpj"],
      hidden: ["followup"],
    });
    expect(menuSchema.parse({ order: "", hidden: "" })).toEqual(DEFAULT_MENU);
  });

  it("recusa módulo desconhecido (inclusive o Dashboard, que não pode ser movido nem oculto)", () => {
    expect(menuSchema.safeParse({ order: "financas,relatorios", hidden: "" }).success).toBe(false);
    expect(menuSchema.safeParse({ order: "", hidden: "dashboard" }).success).toBe(false);
    expect(menuSchema.safeParse({ order: 3, hidden: "" }).success).toBe(false);
  });
});
