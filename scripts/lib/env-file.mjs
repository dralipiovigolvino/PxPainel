// Leitura/escrita de variáveis em .env.local sem imprimir valores.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const ENV_FILE = ".env.local";

/** Define (ou substitui) uma variável no arquivo, preservando as demais linhas. */
export function setEnvVar(name, value, file = ENV_FILE) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Nome de variável inválido: ${name}`);
  if (/[\r\n]/.test(value)) throw new Error(`Valor de ${name} contém quebra de linha`);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const line = `${name}=${value}`;
  const index = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (index >= 0) lines[index] = line;
  else {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push(line);
  }
  writeFileSync(file, `${lines.join("\n")}\n`, { encoding: "utf8" });
}

export function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Variáveis ausentes em ${ENV_FILE}: ${missing.join(", ")}`);
    process.exit(2);
  }
}
