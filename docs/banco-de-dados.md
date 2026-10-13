# Banco de dados, RLS e backup (Neon)

## Estratégia de acesso

O app só acessa o PostgreSQL **no servidor**, com o driver `@neondatabase/serverless` (`Pool`), usando o papel **`app_runtime`** (`APP_DATABASE_URL`). A string de conexão nunca vai para o navegador.

| Papel | Uso | Privilégios |
| --- | --- | --- |
| `neondb_owner` | migrações e provisionamento (scripts) | dono, `BYPASSRLS`, membro de `neon_superuser` |
| `app_runtime` | aplicação | `LOGIN`, sem superusuário, sem `BYPASSRLS`, sem `CREATEROLE`/`CREATEDB`, `NOINHERIT`, sem pertencer a outros papéis. Só os `GRANT`s da migração. Sem acesso ao schema `neon_auth` |

Na primeira conexão, o app confere que o papel não tem `BYPASSRLS` nem é superusuário, e recusa operar caso tenha.

## Como a identidade chega ao RLS

1. `requireUser()` (leitura) ou `requireFreshUser()` (gravação) obtém o usuário da sessão validada pelo Neon Auth. O `id` é o `uuid` de `neon_auth."user".id`.
2. `withUserContext(user, fn)` (`src/lib/db/user-context.ts`) pega **uma** conexão do pool e executa:
   ```sql
   begin;
   select set_config('app.user_id', '<uuid da sessão>', true);  -- true = local à transação
   -- consultas de fn, na mesma conexão e transação
   commit;  -- ou rollback
   ```
3. As políticas usam `app_private.current_user_id()`, que lê `current_setting('app.user_id', true)`. Sem contexto, retorna `NULL` e nenhuma linha é liberada.
4. Ao fim da transação o valor desaparece. A conexão volta ao pool sem identidade. Isso foi testado com uma conexão reaproveitada e com transações simultâneas (`npm run test:rls`).

**Limite do modelo:**
- O banco confia no servidor para definir `app.user_id`, porque o papel `app_runtime` pode definir qualquer valor.
- A proteção depende de manter `APP_DATABASE_URL` em segredo e de o contexto só ser definido a partir da sessão validada.
- O RLS continua impedindo erros de código, como esquecer um filtro, vazamentos entre usuários e transferências de propriedade.

## Regras para todas as tabelas

1. `user_id uuid not null` em toda tabela de dados do usuário, com RLS habilitada e **forçada**.
2. Políticas `to app_runtime` com `user_id = app_private.current_user_id()` em `using` e `with check`.
3. `revoke all ... from public` e `grant` apenas das operações e **colunas** necessárias. Nunca conceda `UPDATE` em `user_id`.
4. Sem chave estrangeira para `neon_auth.*`: é um schema gerenciado pelo provedor e esse vínculo não foi confirmado como suportado. Ao excluir um usuário no Neon Auth, os registros do app ficam órfãos e devem ser removidos pelo dono.
5. **Propriedade entre registros:** a RLS de cada tabela isolada **não basta** para impedir, por exemplo, uma consulta apontando para o paciente de outro usuário. Use chave estrangeira composta:

   ```sql
   create table public.pacientes (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null,
     unique (id, user_id)
   );
   create table public.consultas (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null,
     paciente_id uuid not null,
     foreign key (paciente_id, user_id) references public.pacientes (id, user_id)
   );
   ```

   Aplicar a todos os vínculos: área → lançamento, cartão → fatura → compra, paciente → consulta → acompanhamento, tipo → série → plantão.

## Finanças (migração 0002)

### `public.fin_areas`

| Coluna | Regra |
| --- | --- |
| `id` | uuid, `gen_random_uuid()` |
| `user_id` | uuid do Neon Auth. Imutável: não há `UPDATE` na coluna |
| `name` | 1 a 60 caracteres, aparado, sem controles. **Único por usuário sem diferenciar maiúsculas** (índice em `(user_id, lower(name))`). O app também colapsa espaços internos |
| `color` | `#rrggbb` minúsculo (check). Nada de CSS arbitrário |
| `archived_at` | `NULL` = ativa; preenchida = arquivada |
| `created_at`, `updated_at` | `updated_at` por gatilho |

`unique (id, user_id)` é o alvo da chave estrangeira composta dos lançamentos.

### `public.fin_entries` (contas únicas; despesas)

| Coluna | Regra |
| --- | --- |
| `area_id` + `user_id` | FK composta → `fin_areas(id, user_id)` com `ON DELETE RESTRICT` |
| `description` | 1 a 120 caracteres, aparado, sem controles |
| `amount_cents` | `bigint`, de 1 a 9.999.999.999 (R$ 0,01 a R$ 99.999.999,99). O mesmo limite vale no formulário (`MAX_AMOUNT_CENTS`) e no servidor |
| `due_date` | `date` (data civil), entre 2000-01-01 e 2100-12-31 |
| `category` | texto livre opcional (1 a 40), sem tabela de categorias nesta etapa |
| `notes` | opcional, até 1000; aceita quebra de linha e tabulação |
| `status` | `'pendente'` ou `'pago'`. "Atrasado" **não** é status: é calculado |
| `paid_on` | `date`. Check: pendente ⇒ `NULL`; pago ⇒ preenchida |

Índices: `(user_id, due_date, id)` e `(user_id, area_id, due_date)`.

### Regras garantidas no banco

- **Área de outro usuário:** a FK composta recusa (`23503`), inclusive ao mover uma conta de área.
- **Área com lançamentos não pode ser excluída:** `ON DELETE RESTRICT` gera `23001`.
  - Isso vale sob concorrência: se outra transação insere na área, a exclusão espera e falha.
  - Contas nunca são apagadas em cascata.
- **Área arquivada:** o gatilho `app_private.fin_entries_check_area_active` recusa lançamento novo ou movido para ela (`P0001 fin_area_archived`).
  - Editar outros campos mantendo a área arquivada é permitido, assim como pagar.
  - O gatilho trava a linha da área (`FOR SHARE`): se arquivar e lançar acontecem ao mesmo tempo, o lançamento que esperava é recusado.
- **Grants de `app_runtime`:**
  - `fin_areas`: `SELECT`, `DELETE`, `INSERT(user_id, name, color)`, `UPDATE(name, color, archived_at)`.
  - `fin_entries`: `SELECT`, `DELETE`, `INSERT` das colunas de dados, `UPDATE` das colunas de dados, **sem** `user_id`.
- **RLS forçada** com políticas `select/insert/update/delete` por `app_private.current_user_id()`.

### Regras da aplicação

- **Dinheiro:**
  - `parseBrlToCents` (`src/lib/money.ts`) converte "1234,56", "1.234,56", "1234" e "0,5" a partir dos dígitos (`BigInt`).
  - Recusa negativo, zero, mais de 2 decimais, ponto como decimal e valores acima do limite.
  - O `bigint` do banco é lido como texto (`centsFromDb`) e os totais são somados em `BigInt`.
- **Datas:** o banco devolve `to_char(..., 'YYYY-MM-DD')`, sem objetos `Date`. A exibição é `DD/MM/AAAA`, e "hoje" é calculado em `America/Sao_Paulo`.
- **Atraso:** pendente com vencimento **antes** de hoje. Vencendo hoje não está atrasada.
- **Pagamento:**
  - A data sugerida é hoje; aceita hoje ou antes (datas futuras são recusadas no servidor).
  - Voltar para pendente pede confirmação e apaga a data.
  - Editar a conta (inclusive o vencimento) nunca altera status nem data de pagamento.
- **Filtros (URL):** `?mes=AAAA-MM` (mês de **vencimento**), `area=<uuid>` e `situacao=pendentes|pagos|atrasados`. Valores inválidos voltam ao padrão. Descrições e observações nunca vão para a URL.
- **Resumo:**
  - Total, Pago e Pendente do mês e da área selecionados, sobre **todos** os lançamentos correspondentes, sem paginação.
  - **Não** muda com o filtro de situação. Total = Pago + Pendente.
  - "Pago" = contas com vencimento no mês já pagas, em qualquer data. Não é fluxo de caixa.
- **Atrasados:** o filtro vale dentro do mês e da área selecionados.
- **Ordenação:** `due_date`, depois `created_at` e `id` (estável).

## Forma de pagamento e compras no cartão (migração 0017)

- `fin_entries`, `fin_series` e `fin_installment_plans` têm `payment_method`: `'pix'`, `'boleto'` ou `NULL` (não informada, só em registros anteriores à migração; nada foi convertido). Conta nova exige a escolha.
- A recorrência passa a forma às contas que gera; mudar a forma segue a regra das demais alterações da série (nova série a partir de uma data, sem `UPDATE`). No parcelamento, a forma do plano pode mudar e vale para as parcelas pendentes.
- Compra no cartão não tem `payment_method`: a forma é o próprio cartão. A área da compra pode ser corrigida (`UPDATE (area_id)`), com a mesma chave composta e o mesmo bloqueio de área arquivada.
- `fin_invoices` guarda a fatura de cada cartão por ciclo (fechamento e vencimento). O pagamento e o total dela seguem a migração 0018 (seção seguinte), que substituiu a regra provisória de 0017 ("No cartão", sem pagamento).

## Fatura do cartão: total informado e pagamento (migração 0018)

O usuário não lança todas as compras do cartão (em geral, só as parceladas). Por isso a fatura tem um total próprio, informado por ele, e as compras cadastradas passam a ser só o detalhe.

- `fin_invoices.stated_total_cents`: total da fatura informado pelo usuário (`NULL` = não informado; de 1 a 9.999.999.999). Vale para aquele ciclo e nunca é copiado para outro mês. Nenhuma fatura existente foi convertida.
- **Valor que conta** para a fatura (`invoiceTotal`, em `domain/cards.ts`): o pago, se estiver paga; senão o informado; senão a soma das compras cadastradas. A fatura entra **uma vez** nos totais; as compras nunca são somadas por fora dela.
- Diferença = valor que conta − soma das compras. Positiva: "outros valores da fatura", sem área nem categoria (não é distribuída). Negativa (total menor que as compras): aparece como ajuste, com o sinal; as parcelas não são alteradas.
- **Pagamento** (`status = 'pago'`, `paid_on`): um por fatura. `paid_total_cents` continua definido só pelo gatilho `fin_invoices_payment_guard`: o total informado ou, sem ele, a soma das compras. Fatura sem total e sem compras não pode ser paga (`fin_invoice_empty`). O app não tem permissão de escrever `paid_total_cents`.
- **Fatura paga:** datas e total informado não mudam (`fin_invoice_paid`); é preciso voltar para a pagar, o que limpa o pagamento e mantém o total informado. Restrição `fin_invoices_paid_stated_check`: paga com total informado ⇒ valor pago = total informado.
- **Compras em fatura paga** (`fin_charges_invoice_guard`): com total informado, entram ou saem como detalhe e o valor pago não muda; sem total informado (valor pago = soma das compras), continuam bloqueadas, como antes.
- Fatura a pagar que fica sem compras **e** sem total informado deixa de existir. Informar o total de um mês em que o cartão não tem compras cria a fatura daquele ciclo (pelo mês do vencimento, com os dias atuais do cartão).
- Total do mês = Pago + A pagar: contas fora do cartão mais cada fatura pelo valor que conta, com a situação dela. Contas com valor a informar ficam fora das somas e são contadas à parte.
- Mês e relatórios seguem o **vencimento**; a data do pagamento fica em `paid_on`. Fatura a pagar entra nas pendências do Dashboard (uma por cartão e vencimento).
- Histórico em `fin_events` (`entity_type = 'fatura'`): `total`, `pagamento` e `reabertura` (com a data e o valor do pagamento desfeito).

## Follow-up (migrações 0006 e 0007)

Todas as tabelas têm `user_id`, RLS forçada, políticas `to app_runtime` e grants por coluna; `user_id` nunca é atualizável.

| Tabela | Conteúdo | Vínculos (FK composta com `user_id`) |
| --- | --- | --- |
| `fu_patients` | nome (1–120, nomes iguais permitidos), telefone E.164 opcional, observação (até 1000), arquivamento | — |
| `fu_consultations` | data da consulta realizada, observação (até 2000), `request_id` (idempotência) | paciente (RESTRICT); paciente imutável (sem UPDATE em `patient_id`) |
| `fu_templates` | nome único por usuário, descrição, `version`, arquivamento; **sem DELETE** | — |
| `fu_template_steps` | intervalo 0–3650 dias (único no modelo), mensagem (até 2000), posição | modelo (CASCADE) |
| `fu_plans` | um por consulta (`UNIQUE consultation_id`), cópia do nome/versão do modelo, `request_id`, ativo/cancelado; **sem DELETE** | consulta + paciente `(consultation_id, patient_id, user_id)`; modelo de origem |
| `fu_steps` | intervalo original, cópia da mensagem, ajuste da etapa, data original e prevista, remarcação, pendente/realizado/cancelado, instante e texto da realização, observação, motivo; **sem DELETE** | plano |
| `fu_events` | histórico de ações (somente inclusão), detalhes estruturados | paciente, consulta, plano e etapa |

Regras garantidas no banco:
- Consulta: data não futura no fuso de São Paulo e paciente arquivado sem consulta nova (gatilho `fu_consultations_guard`).
- Etapas (gatilho `fu_steps_guard`):
  - pendente → realizado ou cancelado;
  - realizado → pendente (desfazer, limpa a realização) ou só observação;
  - cancelado é final;
  - plano cancelado não recebe etapas nem mudanças;
  - o instante da realização e do cancelamento vem do servidor (sem grant de escrita no app).
- Índice parcial único `(plan_id, day_offset)` para etapas não canceladas: nenhum intervalo duplicado vivo, e as substituídas continuam no histórico.
- Plano cancelado não volta a ativo (gatilho `fu_plans_guard`).

Regras da aplicação:
- Leituras de pacientes usam `requireVerifiedUser()`: sessão confirmada no Neon Auth, sem o cache de 60 s. Uma cópia de cookies de sessão revogada leva ao login.
- Gravações usam `requireFreshUser()`.
- Operações compostas (consulta + plano, substituição, correção de data, cancelamento) rodam numa transação, com bloqueio da consulta, do plano e da etapa.
- Busca de pacientes só no navegador; URLs só com ids. Erros registram só o código, nunca nome, telefone ou texto.

## Plantões (migrações 0008 a 0010)

Todas as tabelas têm `user_id`, RLS forçada, políticas `to app_runtime` e grants por coluna; `user_id` nunca é atualizável.

| Tabela | Conteúdo | Vínculos (FK composta com `user_id`) |
| --- | --- | --- |
| `pl_types` | nome único, local, valor padrão (centavos, > 0), cor `#rrggbb`, horários padrão, observação, arquivamento | — |
| `pl_series` | dias da semana (máscara), a cada 1–12 semanas, início/fim, valores copiados, `generated_until`, suspensão; **sem DELETE e sem alterar a regra no lugar** | tipo (RESTRICT) |
| `pl_series_exceptions` | datas originais excluídas (não são recriadas) | série (CASCADE) |
| `pl_shifts` | data de início, horários (fim no dia seguinte explícito, até 24 h), valor, observação, situação, realização, recebimento; `series_id` + `original_date` únicos e imutáveis; `moved_at` | tipo (RESTRICT, imutável), série (RESTRICT) |
| `pl_events` | histórico somente inclusão; sobrevive à exclusão da ocorrência (`ON DELETE SET NULL (shift_id)`) | ocorrência, tipo |

Regras garantidas no banco:
- Horários: ambos vazios ou início + fim + "dia seguinte"; no mesmo dia, fim > início; no seguinte, fim ≤ início.
- Tipo arquivado não recebe ocorrência nem série nova.
- Instantes (cancelamento, movimentação, realização) e o valor recebido vêm de gatilhos; o app não grava esses campos.
- Recebido: valor = valor da ocorrência, data até hoje (São Paulo); não muda valor nem cancela.
- Realizado não vira cancelado direto.
- Realizados e recebidos não são excluídos pelo app.
- Cancelado não pode estar recebido.

Regras da aplicação:
- Geração das recorrências só por ação autenticada explícita (nunca na renderização), idempotente e serializada, até o horizonte (mês de hoje + 12), com limite de 120 meses e aviso de período incompleto.
- Edição de série divide numa transação, preservando realizados, recebidos, movidos e alterados.

## Menu do usuário (migração 0019)

- `user_preferences.menu_order` e `user_preferences.menu_hidden` (`text[]`, padrão `'{}'`): a ordem dos módulos no menu e os módulos ocultos, por usuário. Listas vazias = menu padrão; nenhuma linha existente foi alterada.
- Só valem `'financas'`, `'followup'`, `'plantoes'`, `'pericias'` e, desde a migração 0020, `'cnpj'` (restrições `user_preferences_menu_order_check` e `user_preferences_menu_hidden_check`). O Dashboard não entra: é sempre o primeiro e não pode ser ocultado.
- O app normaliza o que lê e grava (`normalizeMenu`, em `src/config/modules.ts`): sem repetição, e módulo que faltar na ordem vai para o fim, visível.
- **Ocultar não apaga nem bloqueia nada:** o módulo sai do menu (lateral e barra do celular) e do Dashboard (não é consultado, nem conta como falha); as telas continuam acessíveis pelo endereço.
- Mesma RLS e os mesmos grants por coluna das demais preferências: cada usuário lê e grava só a própria linha.

## CNPJ e imposto estimado (migração 0020)

O percentual estimado de imposto deixou de ser uma preferência do usuário (`user_preferences.tax_rate_bp`, da 0011) e passou a ser do CNPJ cadastrado. A coluna antiga continua existindo só como sugestão para o primeiro cadastro.

### `public.cnpjs`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `id` | uuid | chave primária |
| `user_id` | uuid | dono; nunca muda (sem grant de UPDATE) |
| `name` | text | 1 a 80 caracteres, sem espaços nas pontas; único por usuário, sem diferenciar maiúsculas |
| `cnpj_number` | text, opcional | só os 14 caracteres, sem pontuação: 12 letras maiúsculas ou dígitos + 2 dígitos verificadores (aceita o formato alfanumérico de 2026). Os dígitos verificadores são conferidos no app (`src/lib/cnpj.ts`) |
| `tax_rate_bp` | integer | estimativa de imposto em pontos-base (900 = 9,00%), de 0 a 10000 |
| `tax_due_day` | smallint | dia do pagamento do imposto, no mês seguinte ao do trabalho (1 a 31; padrão 20) |

RLS habilitada e forçada, com as quatro políticas "só o que é seu"; o app tem SELECT e DELETE na tabela e INSERT/UPDATE por coluna.

### Marcação "recebo por CNPJ"

- Coluna `cnpj_id` (opcional) em `pl_types` e `per_companies` (padrão copiado para os novos registros) e em `pl_series`, `pl_shifts` e `per_exams` (o valor de cada registro). Chave estrangeira composta `(cnpj_id, user_id)`: o CNPJ é sempre da mesma conta, e CNPJ em uso não é apagado (RESTRICT).
- **Plantões:** "por CNPJ" é o antigo valor bruto. As restrições `*_cnpj_kind_check` garantem `cnpj_id` preenchido ⇔ `amount_kind = 'bruto'` (e a restrição da 0013 continua exigindo alíquota gravada só nesse caso). Sem CNPJ: `'liquido'` ou, em registros anteriores, sem classificação.
- **Perícias:** deixaram de ter imposto sempre. Sem CNPJ a alíquota gravada é 0 (`per_exams_cnpj_rate_check`).
- **Alíquota por registro:** ao marcar, o plantão ou a perícia copia o percentual do CNPJ naquele momento (`tax_rate_bp` do registro). Editar no mesmo CNPJ preserva a cópia; trocar de CNPJ ou marcar de novo usa o percentual atual.
- **Recorrência de plantões:** o CNPJ muda como as demais regras (nova recorrência a partir de uma data); não há UPDATE de `cnpj_id` em `pl_series`.

### Regras da aplicação

- **Imposto no mês seguinte:** o imposto estimado do trabalho de um mês (plantões e perícias por CNPJ, não cancelados, pelo dia do trabalho) é pago no mês seguinte, no dia `tax_due_day` (`src/modules/cnpj/domain/tax.ts`). A soma é feita registro a registro, com a alíquota de cada um.
- **Mudança do percentual do CNPJ** (`updateCnpj`): vale para o trabalho do mês corrente em diante — plantões e perícias daquele CNPJ a partir do dia 1º (qualquer situação, recebidos ou não) e recorrências ainda ativas; meses anteriores guardam a alíquota que tinham. Cada registro alterado ganha uma linha de histórico (`aliquota_atualizada`).
- **Recebimento registrado:** o valor continua travado; a marcação de CNPJ e a alíquota podem ser corrigidas (os gatilhos `pl_shifts_pay_guard` e `per_exams_guard` deixaram de travá-las), porque o imposto é uma estimativa à parte.
- **Finanças → Visão geral:** entradas pelo dia em que o dinheiro entra (recebimento registrado; sem ele, a data prevista de pagamento; sem ela, o dia do trabalho) e o imposto estimado como saída, fora de Pago e de A pagar. Nada é gravado em tabelas de Finanças: tudo é lido de Plantões, Perícias e CNPJ a cada consulta.

### Registros existentes

A migração cria um CNPJ "Meu CNPJ" (com o percentual das preferências) **só para contas que já tinham** plantões em valor bruto, perícias ou empresas, e liga esses registros a ele, sem tocar em valores, alíquotas, datas nem em `updated_at`. Contas sem esses registros não ganham nada.

## Migrações

- **Local:** `db/migrations/NNNN_nome.sql`.
- **Aplicação:** `npm run db:migrate`, com a conexão do dono, uma transação por arquivo e checksum registrado em `app_private.schema_migrations`.
- **Arquivos aplicados não podem ser editados:** o script acusa a divergência. Crie uma nova migração.
- **Trava de branch:** só roda com `NEON_BRANCH=development`. Para outra branch, defina `DB_ALLOW_BRANCH` conscientemente.

**Migrações não são backup:** elas recriam a estrutura, mas nenhum registro.

## Backup e restauração

Procedimento, comandos e evidências: **[backup.md](backup.md)**.

- **Dados do app** (`public` e `app_private`): backup lógico com `npm run db:backup` e restauração conferida com `npm run db:restore`. Ensaio completo aprovado em 03/10/2026 (28/28).
- **Identidades** (`neon_auth`: usuários, senhas, sessões): **fora** do backup do app; ficam com o Neon Auth. Recuperação de identidades ainda **não testada**.
- **Plano Free do Neon** (verificado no projeto): `history_retention_seconds = 21600` (6 horas de histórico) e 1 snapshot manual.

**Pendente antes de dados reais:** testar uma recuperação que inclua identidades e definir a rotina de backup (ver backup.md).
