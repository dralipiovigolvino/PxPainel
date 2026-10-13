# Backup e restauração

Este documento descreve o que o backup do app cobre, o que ele **não** cobre, como executar e o que já foi provado. Não contém credenciais.

## Resumo

| O quê | Onde fica | Quem cuida | Coberto pelo `db:backup`? | Restauração testada? |
| --- | --- | --- | --- | --- |
| Dados do app (contas, cartões, pacientes, acompanhamentos, plantões, preferências) | schemas `public` e `app_private` | este projeto | **Sim** | **Sim** — ensaio de 03/10/2026, 28/28 |
| Estrutura (tabelas, regras, RLS, permissões) | `db/migrations/` no repositório | este projeto | Recriada pelas migrações; conferida contra o backup | **Sim** (mesmo ensaio) |
| Identidades: usuários, senhas (hashes), papéis, sessões | schema `neon_auth` | **Neon Auth** (provedor) | **Não** | **Não** — pendente |
| Configuração do Neon Auth (cadastro desligado, remetente de e-mail, domínios) | serviço do Neon, por branch | **Neon Auth** (provedor) | **Não** | **Não** — pendente |
| Segredos do app (`.env.local`, variáveis da hospedagem) | fora do banco | você | **Não** | não se aplica |

**O backup do app não inclui usuários nem senhas.** Restaurar só os dados do app devolve os registros, mas não devolve a possibilidade de entrar: veja "Identidades e vínculo por `user_id`".

## Comandos

Todos usam a conexão do **dono** do banco e só rodam na branch `development`, salvo `DB_ALLOW_BRANCH` definido de propósito.

```bash
# 1. Backup lógico dos dados do app para uma pasta VAZIA e FORA do repositório
npm run db:backup -- --out "D:/backups/app-pessoal/2026-10-04"

# 2. Restauração num banco de destino VAZIO (branch descartável), com conferência
#    RESTORE_DATABASE_URL = conexão do dono da branch de destino; nunca a branch ligada a esta pasta
npm run db:restore -- --from "D:/backups/app-pessoal/2026-10-04" --confirm-endpoint ep-xxxxxxxx

# 3. Ensaio completo com dados fictícios (cria e apaga uma branch descartável)
npm run db:restore-drill
```

O que cada um faz:

- **`db:backup`**
  - Lê tudo numa única transação somente leitura (instantâneo consistente).
  - Grava um arquivo `.json` por tabela e um `manifest.json` com: versões e checksums das migrações, contagem e md5 do conteúdo de cada tabela, sha256 de cada arquivo e a impressão digital da estrutura.
  - Recusa gravar dentro do repositório ou em pasta não vazia.
  - A pasta contém **dados pessoais**: guarde em local protegido (de preferência criptografado) e nunca no repositório.
- **`db:restore`**
  - Recusa: destino igual à branch ligada; destino com qualquer linha de dados do app; migrações do repositório diferentes das do backup; arquivo alterado (sha256).
  - Aplica as migrações do repositório no destino vazio, carrega os dados numa única transação (pais antes dos filhos, chaves estrangeiras valendo) e confere contagens, conteúdo, estrutura, chaves estrangeiras e gatilhos.
  - Depois da restauração, o papel `app_runtime` do destino ainda **não tem login**: rode o provisionamento naquela branch para gerar a conexão do app.
- **`db:restore-drill`**
  - Roteiro abaixo. Precisa da CLI do Neon autenticada e das contas fictícias A e B.

Limite conhecido: cada tabela é lida e gravada de uma vez (adequado ao volume de uso pessoal; não foi testado com tabelas de centenas de milhares de linhas).

## Evidência do ensaio (03/10/2026, 28/28 verificações)

Ambiente: backup tirado de `development`; restauração numa branch **descartável** criada a partir de `production` (que não tinha tabelas do app e não foi alterada), apagada ao final.

Dados: cenário fictício `[teste-backup]` nas contas de teste A e B — 33 linhas cobrindo os três módulos; o backup inteiro tinha 24 tabelas e 45 linhas.

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | Cenário fictício inserido em development | OK |
| 2 | Backup gravado fora do repositório (24 tabelas, 45 linhas, migrações até 0010) | OK |
| 3 | Branch descartável criada | OK |
| 4 | Arquivos do backup íntegros (sha256, 24 arquivos) | OK |
| 5 | 10 migrações aplicadas no destino vazio (0001 … 0010) | OK |
| 6 | Migrações do destino = do backup (versão e checksum) | OK |
| 7 | Mesmas 24 tabelas | OK |
| 8 | Dados carregados numa única transação (35 linhas; as 10 restantes são o registro de migrações, recriado) | OK |
| 9 | Contagem e conteúdo (md5) idênticos nas 23 tabelas de dados | OK |
| 10 | Estrutura idêntica: 24 tabelas, 247 colunas, 344 restrições, 79 índices, 76 políticas, 33 gatilhos, 16 funções, 35 + 233 + 3 + 1 permissões, papel do app | OK |
| 11 | Chaves estrangeiras válidas | OK |
| 12 | Gatilhos religados | OK |
| 13 | Papel do app sem superusuário nem BYPASSRLS | OK |
| 14 | Sem contexto de usuário: nenhuma linha visível (23 tabelas) | OK |
| 15 | A vê exatamente as linhas de A | OK |
| 16 | B vê exatamente as linhas de B | OK |
| 17 | Valores do cenário iguais aos calculados à mão: 5 contas, R$ 248,45 conhecidos + 1 a informar; fatura R$ 300,00; 2 etapas; plantões R$ 1.800,00, recebido R$ 1.000,00 | OK |
| 18 | Valores de B e isolamento A/B | OK |
| 19 | Relações navegáveis (parcela→plano, cobrança→compra/fatura, etapa→plano→consulta→paciente, plantão→série) | OK |
| 20 | A não grava linha em nome de B (RLS) | OK |
| 21 | Coluna sem permissão não é alterável | OK |
| 22 | Tabela interna de migrações inacessível ao app | OK |
| 23 | Recusa restaurar sobre banco que já tem dados | OK |
| 24 | Recusa backup adulterado | OK |
| 25 | Comparação de estrutura detecta RLS/permissão alterados de propósito | OK |
| 26 | Branch descartável apagada | OK |
| 27 | Cenário removido de development (33 linhas, por IDs) | OK |
| 28 | Pasta temporária do backup apagada | OK |

Depois do ensaio: só as branches `development` e `production`; 0 resíduos em development.

O que o ensaio **não** prova: restauração de identidades; restauração sobre a produção real; volume grande; recuperação a partir de um backup antigo depois de novas migrações (o `db:restore` exige que as migrações do repositório até a versão do backup sejam as mesmas).

## Identidades e vínculo por `user_id`

Cada registro do app guarda o `user_id` do dono, que é o identificador do usuário no Neon Auth. Não há chave estrangeira para o schema do provedor. Consequências:

- **Banco inteiro recuperado pelo Neon** (restauração instantânea ou snapshot da branch): dados do app e `neon_auth` voltam juntos, com os mesmos `user_id`. Os vínculos continuam válidos. É o caminho principal para "apaguei algo sem querer" ou "o banco corrompeu".
- **Só o backup lógico disponível** (ex.: projeto Neon perdido): os dados voltam, mas os usuários não. Um usuário recriado no Neon Auth recebe um **novo** identificador, e os registros restaurados ficam invisíveis para ele (o RLS filtra pelo identificador antigo). Para religar seria preciso trocar o `user_id` antigo pelo novo em todas as tabelas, numa única transação, com o dono do banco.

O que existe hoje para cada caminho:

| Caminho | Situação |
| --- | --- |
| Restauração instantânea do Neon (inclui `neon_auth`) | **Não testada.** No plano Free a janela é de 6 horas; a página de preços também diz que a restauração instantânea não está disponível no Free — informação contraditória, a confirmar no console |
| Snapshot manual do Neon (1 no plano Free) | **Não testado** |
| Backup lógico dos dados do app | **Testado** (acima) |
| Religar dados a um usuário recriado (troca de `user_id`) | **Não implementado nem testado.** Não há script; não deve ser feito por tentativa em produção |
| Exportar/importar o schema `neon_auth` | **Não avaliado.** Contém hashes de senha e chaves do provedor; não manipular por suposição |

**Pendências antes de usar dados reais:**

1. Testar uma recuperação que inclua identidades (restauração instantânea ou snapshot numa branch de teste) e entrar com um usuário fictício depois dela.
2. Escrever e ensaiar o procedimento de troca de `user_id`, ou decidir que a recuperação de identidade dependerá sempre do Neon.
3. Definir a rotina: frequência do `db:backup`, onde a pasta fica guardada e por quanto tempo.
4. Para produção, a mesma rotina exige a conexão do dono da branch `production` e `DB_ALLOW_BRANCH=production` — ainda não configurado.

## `pg_dump`

Alternativa padrão do PostgreSQL, **não testada** aqui: exige o cliente na versão 18, que não está instalado nesta máquina. A documentação do Neon pede conexão sem pooler e `--no-owner`. Os scripts acima existem para não depender dessa instalação.
