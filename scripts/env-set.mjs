// Grava uma variável em .env.local lendo o valor da entrada padrão (não aparece no terminal).
// Uso: <comando que imprime o valor> | npm run env:set -- NOME
//      npm run env:set -- NEON_AUTH_COOKIE_SECRET --random   (gera 48 bytes aleatórios)

import { randomBytes } from "node:crypto";
import { setEnvVar } from "./lib/env-file.mjs";

const [name, flag] = process.argv.slice(2);
if (!name) {
  console.error("Informe o nome da variável.");
  process.exit(2);
}

let value;
if (flag === "--random") {
  value = randomBytes(48).toString("base64url");
} else {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  value = Buffer.concat(chunks).toString("utf8").trim();
}
if (!value) {
  console.error(`Nenhum valor recebido para ${name}.`);
  process.exit(2);
}
setEnvVar(name, value);
console.log(`${name} gravada em .env.local (${value.length} caracteres).`);
