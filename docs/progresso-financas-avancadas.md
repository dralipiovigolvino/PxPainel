# Progresso — Finanças avançadas (Etapas 4 a 7)

Arquivo de retomada. Não contém segredos, credenciais nem dados pessoais.

## Contexto de partida (28/09/2026)

- Projeto Neon `young-unit-87419729`, branch **development** (pasta ligada por `.neon`). A `production` não é tocada.
- Migrações aplicadas: `0001_user_preferences`, `0002_financas_basicas`.
- Tabelas de Finanças vazias no início do bloco (sem dados do usuário).
- Migrações aplicadas neste bloco: `0003_recorrencias`, `0004_parcelamentos`, `0005_cartoes_faturas` (todas na development).
- Contas de teste fictícias A e B no `.env.local` (`RLS_TEST_*`). Dados de teste com prefixos `[teste-rls …]` e `[teste-e2e]`.

## Desenho geral (decidido antes da Etapa 4)

- **Obrigações "fora do cartão"** continuam em `fin_entries`. Cada linha é uma única, uma ocorrência de série ou uma parcela de plano.
- **Recorrências:**
  - A regra fica em `fin_series`. As ocorrências concretas são linhas de `fin_entries` com `series_id` e `occurrence_date` (data original, imutável), com unicidade por `(series_id, occurrence_date)`.
  - Exclusões de ocorrência viram linhas em `fin_series_exceptions`.
- **Geração:**
  - Materializada até um horizonte (`generated_until`) por uma operação **explícita e autenticada** (Server Action).
  - Idempotente (`ON CONFLICT DO NOTHING`) e serializada por série (`FOR UPDATE`).
  - Nunca durante a renderização nem no prefetch.
- **Parcelamentos:** plano em `fin_installment_plans`; parcelas em `fin_entries` (`installment_plan_id`, `installment_number`).
- **Cartões:**
  - `fin_cards` → `fin_invoices` (datas concretas por ciclo) → `fin_card_purchases` → `fin_card_charges`.
  - Compras de cartão **não** geram `fin_entries`.
- **Relatórios:**
  - Agenda: `fin_entries` + faturas inteiras.
  - Despesas por área ou categoria: `fin_entries` + cobranças, pelo vencimento da fatura.

## Etapa 4 — Recorrências e contas variáveis

**Status: concluída e verificada no Neon real (development).**

Decisões:
- **Periodicidades:** `semanal` (7 dias), `quinzenal` (14 dias, não "duas vezes por mês") e `mensal` com `interval_months` de 1 a 24 (trimestral = 3, semestral = 6, anual = 12).
- **Âncora:** é a primeira data. No mensal, o dia é ajustado ao último dia do mês quando não existe e volta ao dia original nos meses que o têm (`addMonthsAnchored`).
- **Identidade da ocorrência:** `(series_id, occurrence_date)` com `UNIQUE`. `occurrence_date` é imutável (sem grant de UPDATE). O vencimento (`due_date`) é editável sem recriar.
- **Geração:**
  - `generateForUser` materializa até um alvo, dentro da transação da operação. Idempotente (`ON CONFLICT DO NOTHING`), serializada por `FOR UPDATE` nas séries, ignora exceções e séries suspensas ou de área arquivada.
  - Horizonte padrão: fim do mês de hoje + 12 meses.
  - Mecanismo: a página faz uma checagem **somente leitura** (`needsGeneration`). Se faltar gerar até o mês exibido (ou o horizonte), o componente cliente `GenerationSync` chama a Server Action `ensureGenerationAction` depois de montar a tela (nunca na renderização nem no prefetch).
  - Gera todo o intervalo pendente de uma vez, sem depender de visitar meses intermediários. Limite de segurança: 120 meses.
- **Variável:**
  - A ocorrência nasce com `amount_cents NULL` e `is_variable = true`.
  - Nova regra do banco: `NULL` só para variável pendente; pago exige valor.
  - O resumo mostra "R$ X conhecidos + N contas com valor a informar".
- **Alcance das edições:**
  - "Somente esta ocorrência": marca `is_override`.
  - "Esta e as próximas" (a partir da data original da ocorrência) e "Ocorrências futuras" (a partir de hoje): `splitSeries` em uma transação. Encerra a antiga na véspera, remove pendentes substituíveis, cria a nova série, leva as preservadas cuja data existe na nova regra, copia as exceções e gera.
  - Preservadas = pagas, personalizadas ou variáveis com valor informado.
  - Prévia (`seriesImpact`) mostra quantidade, período e preservadas.
- **Excluir ocorrência** grava `fin_series_exceptions`. **Encerrar** define `end_date`/`ended_at` e remove pendentes substituíveis posteriores.
- **Área arquivada:**
  - Arquivar com séries ativas exige confirmação (a ação devolve `confirm`) e suspende as séries (`suspended_at`).
  - Restaurar não retoma. A retomada é explícita, com data, e o intervalo suspenso não é preenchido.
- **Acessibilidade:** `NoticeRegion` recria o parágrafo do aviso a cada sucesso (key nova), então mensagens repetidas voltam a ser anunciadas.

Arquivos:
- `db/migrations/0003_recorrencias.sql`
- `src/modules/financas/series-data.ts`, `domain/recurrence.ts`, `domain/schemas.ts` (seriesSchema)
- `components/series-fields.tsx`, `series-dialogs.tsx`, `series-manager.tsx`, `generation-sync.tsx`, `amount-dialog.tsx`, `finance-nav.tsx`
- `src/app/(app)/financas/recorrencias/page.tsx`
- `vitest.integration.config.mts`, `test/*`, `series.integration.test.ts`
- `scripts/e2e-financas-avancadas.mjs`

Testes (todos passando):
- Unitários: 102 (datas, recorrências, validações).
- Integração no Neon real (`npm run test:int`): 9/9, código do servidor + `app_runtime`.
- RLS (`npm run test:rls`): 76/76 (12 novos de séries e exceções).
- Navegador (`npm run test:e2e:avancadas -- etapa4`): 39/39.
- Regressão da Etapa 3 (`test:e2e:financas`): 53/53.

Correções durante a etapa:
- O script e2e não contava exceções como falha. Agora conta (e2e-auth, e2e-financas, e2e-avancadas).
- A mensagem "recorrências suspensas" aparecia ao restaurar qualquer área. Agora só aparece quando há séries suspensas, com a quantidade.

Pendências: nenhuma bloqueante. Série antiga dividida continua "ativa" até sua data final (conta na confirmação de arquivamento).

## Etapa 5 — Parcelamentos

**Status: concluída e verificada no Neon real.**

Decisões:
- **Plano e parcelas:** o plano (`fin_installment_plans`) fica separado das parcelas (linhas de `fin_entries` com `installment_plan_id` + `installment_number`, únicos por plano).
  - 2 a 120 parcelas, mensais e ancoradas no primeiro vencimento, com ajuste de fim de mês.
  - Total ≥ quantidade: nenhuma parcela zero.
- **Distribuição:** `splitCents` coloca o resto dos centavos nas primeiras parcelas (100,00/3 = 33,34 + 33,33 + 33,33). A prévia na tela usa a mesma função.
- **Criação transacional:** plano + parcelas numa transação. Um gatilho adiado (constraint trigger) confere no commit que há N parcelas somando o total.
  - Idempotência: `request_id` por formulário, `UNIQUE (user_id, request_id)` e `ON CONFLICT DO NOTHING`.
  - No cliente, o segundo envio é bloqueado; um reenvio confirma o mesmo plano.
- **Restrições** (gatilho `fin_entries_installment_guard`, aplicado ao papel `app_runtime`):
  - valor, área e número fixos;
  - vencimento só muda se a parcela estiver pendente;
  - cancelada é final;
  - parcela não é excluída.
  - Total e quantidade do plano não têm grant de UPDATE.
  - Para mudar a estrutura: cancelar as pendentes e criar outro plano (texto orienta).
- **Cancelamento:** status `cancelado` (apenas parcelas), com prévia de quantidade e valor.
  - Pagas preservadas.
  - Registro em `fin_installment_plans.canceled_at/canceled_count` e em `fin_events` (auditoria, somente inserção).
  - Canceladas não aparecem no mês nem entram em totais.
- **Área arquivada:** impede plano novo; parcelas existentes podem ser pagas.

Arquivos:
- `db/migrations/0004_parcelamentos.sql`
- `domain/installments.ts` (+ testes), `installments-data.ts`
- `components/plan-forms.tsx`, `plans-manager.tsx`
- `app/(app)/financas/parcelamentos/page.tsx`
- `installments.integration.test.ts`

Testes:
- Unitários: 6 novos (108 no total).
- Integração no Neon real: 7 novos (16/16).
- RLS: 91/91 (15 novos: plano inconsistente recusado no commit, parcela zero, total imutável, valor imutável, sem exclusão, B sem acesso, eventos somente inserção).
- Navegador: 23/23 da Etapa 5; as Etapas 4 e 5 juntas somam 62/62.

Correções:
- Limpeza dos testes de integração: `fin_events` antes dos planos; referência condicional a tabelas futuras. Um evento residual de teste (conta A) foi removido.
- Duplo envio: mensagem única e bloqueio no cliente.
- Abas de Finanças passam a quebrar em linhas no celular (antes rolavam horizontalmente).

## Etapa 6 — Cartões e faturas

**Status: concluída e verificada no Neon real.**

Decisões:
- **Modelo:** `fin_cards` → `fin_invoices` (uma por ciclo, `UNIQUE (card_id, reference_month)`, com datas concretas gravadas) → `fin_card_purchases` → `fin_card_charges` (uma por parcela). Compras de cartão não geram `fin_entries`.
- **Ciclo** (`domain/cards.ts`): referência = mês em que a fatura fecha.
  - Compra antes do dia de fechamento → fatura que fecha naquele mês; no dia do fechamento ou depois → a seguinte.
  - Vencimento ≤ fechamento → vence no mês seguinte ao fechamento.
  - Dias inexistentes (29–31) usam o último dia do mês.
- **Primeira fatura explícita:** opcional, do mês anterior à compra até 3 meses depois. A prévia mostra as faturas, datas reais (inclusive ajustadas) e valores antes de confirmar, e avisa se alguma está paga.
- **Parcelas no cartão:** 1 a 48; resto dos centavos nas primeiras (mesma `splitCents`). Idempotência por `request_id`.
- **Mudar os dias do cartão** não altera faturas já criadas; só os ciclos novos. Ajuste de datas é por fatura (apenas pendente), com vencimento ≥ fechamento.
- **Pagamento:** integral. O banco calcula `paid_total_cents` sob bloqueio; fatura vazia é recusada.
  - Fatura paga não recebe, não perde e não altera cobranças, nem muda datas (gatilhos para todos os papéis, com `FOR SHARE` contra corrida).
  - Reabrir exige confirmação e limpa data e total pagos. O pagamento anterior fica em `fin_events`, assim como ajustes de datas, compras e exclusões.
- **Cartão arquivado:** não recebe compras; faturas continuam visíveis e pagáveis; pode ser restaurado. Excluir só sem vínculos (RESTRICT).
- **Excluir compra:** remove todas as parcelas; recusado se alguma fatura envolvida estiver paga. Faturas pendentes que ficam vazias são removidas. Na tela da fatura, o servidor redireciona para a lista com aviso.
- **Tela da fatura:** total da fatura + "Valor por área" (soma = total). Base da distinção "valor desta área" × "total da fatura" da Etapa 7.

Arquivos:
- `db/migrations/0005_cartoes_faturas.sql`
- `domain/cards.ts` (+ `cards.test.ts`), `cards-data.ts`, `card-actions.ts`, `domain/schemas.ts` (cardSchema, purchaseSchema, invoiceDatesSchema)
- `components/cards-manager.tsx`, `card-form-dialog.tsx`, `purchase-form-dialog.tsx`, `invoice-detail.tsx`, `finance-nav.tsx` (aba Cartões), `form-bits.tsx` (aviso inicial)
- `app/(app)/financas/cartoes/page.tsx`, `app/(app)/financas/cartoes/faturas/[id]/page.tsx`
- `cards.integration.test.ts`, `scripts/rls-check.mjs`, `scripts/e2e-financas-avancadas.mjs`, `scripts/lib/browser.mjs`, `vitest.config.mts`

Testes:
- Unitários: 119/119 (11 de ciclos: fevereiro, dias 29–31, vencimento no mês seguinte, arredondamento).
- Integração no Neon real: 28/28 (12 de cartões: primeira fatura explícita, mudança de dias, pagar/reabrir, corrida pagar × lançar, fatura com várias áreas, isolamento A/B).
- RLS: 114/114 (23 novos de cartões e faturas).
- Navegador: 47/47 da Etapa 6, incluindo 375/768/1280 px e B sem acesso à fatura de A. Etapas 4 a 6: 109/109.
- Regressão: Etapa 3 e autenticação passando.

Correções:
- `setValue` dos testes de navegador não atualizava campos controlados do React. Agora usa o setter nativo; as etapas anteriores continuam passando.
- Limpeza e2e: parâmetros sempre tipados.
- `npm test` passou a excluir `*.integration.test.ts`, que rodam só com `npm run test:int`.
- Tela da fatura virava 404 ao excluir sua última compra. Corrigido com o redirecionamento acima.

Pendências: nenhuma bloqueante. A tela do mês ainda não mostra faturas; isso entra na visão consolidada da Etapa 7.

## Etapa 7 — Visão financeira consolidada

**Status: concluída e verificada no Neon real.**

Decisões:
- **Nova aba "Visão geral"** (`/financas/visao`). A aba Mês continua sendo a tela de manutenção das contas fora do cartão; o resumo dela passou a dizer isso.
- **Cálculo puro** em `domain/overview.ts` (`buildOverview`), usado pela tela e pelos testes:
  - Resumo: total conhecido = pago + pendente conhecido. Atrasado é parte do pendente (pendente com vencimento antes de hoje, São Paulo). Contas "a informar" são contadas à parte, nunca como zero.
  - Por tipo: únicas, recorrentes fixas, variáveis, parcelas, faturas de cartão (a soma dos tipos = total).
  - Despesas por área e por categoria: contas + cobranças do cartão, atribuídas pelo vencimento da fatura.
  - Agenda por dia: contas + faturas INTEIRAS. Compras de cartão nunca aparecem como contas → sem dupla contagem.
  - Com filtro de área/categoria, cada fatura entra com o "valor desta seleção" e mostra o "total da fatura".
- **Filtros na URL:** mês, período personalizado (até 24 meses), área, categoria, cartão, tipo, situação.
  - A situação filtra só a agenda; resumo, tipos e despesas não mudam (mesma convenção da aba Mês).
  - Ids desconhecidos (de outra conta) viram "todos".
- **Projeções** 1/3/6/12 meses após o mês selecionado (ou o mês do fim do período), com os filtros de área, categoria, cartão e tipo. Separam obrigações conhecidas, "a pagar" e "já pago"; "a informar" à parte; canceladas excluídas.
- **Sem ocorrências virtuais:** a tela verifica em modo somente leitura (`needsGeneration`) se as recorrências estão geradas até o fim das projeções. Se não estiverem, `GenerationSync` dispara a geração idempotente da Etapa 4. Tudo é somado a partir de linhas materializadas; não há como contar a mesma ocorrência duas vezes.
- **Carregamento** (`overview-data.ts`): 2 consultas com RLS (contas sem canceladas; faturas com partes por área e categoria) + lista de categorias usadas.

Arquivos:
- `domain/overview.ts` (+ `overview.test.ts`), `overview-data.ts`, `overview.integration.test.ts`
- `components/overview-filters.tsx`, `overview-view.tsx`, `finance-nav.tsx` (aba Visão geral)
- `app/(app)/financas/visao/page.tsx`, `app/(app)/financas/page.tsx` (texto do resumo)
- `scripts/e2e-financas-avancadas.mjs` (bloco etapa7 e capturas opcionais com `E2E_SHOTS_DIR`)

Testes:
- Unitários: 128/128 (9 novos da visão).
- Integração no Neon real: 37/37 (9 novos). Cenário fictício com resultados calculados à mão: outubro 2.450 = 300 pago + 2.150 pendente, atrasado 1.500, 1 a informar; áreas 1.950 + 500; projeções 630/1.230/1.530/2.130; gerar de novo não muda nada; B não recebe nada de A.
- Navegador: 21/21 da Etapa 7, com geração disparada pela tela, filtros, agenda, projeções, isolamento B e 375/768/1280 px. Etapas 4 a 7 juntas: 130/130.
- Regressão final: lint, typecheck, build, RLS 114/114, Etapa 3 53/53, autenticação 32/32.

Correções:
- Grade "Por tipo" transbordava a 768 px (área útil de ~513 px) → 4 colunas só a partir de xl.
- Agenda a 375 px espremia o nome da fatura → valor abaixo da descrição no celular.
- Etapa 7 com as demais na mesma rodada somava dados das etapas anteriores → limpa os dados de teste da rodada antes de começar.
- 14 eventos órfãos de compras excluídas pela interface (conta de teste A) foram removidos. A limpeza e2e passa a remover os eventos da conta A criados durante a rodada.

## Estado final do bloco

- Etapas 4, 5, 6 e 7 concluídas. Tabelas de Finanças vazias após os testes (nenhum resíduo).
- Pendências conhecidas, fora do escopo e NÃO resolvidas:
  - backup e restauração;
  - entrega de e-mails do Neon Auth;
  - SDK de autenticação beta (`@neondatabase/auth` 0.5.0-beta, fixado);
  - troca da senha temporária pelo próprio usuário (o arquivo temporário não foi apagado).
- Não verificado: leitores de tela reais (só a estrutura ARIA); navegadores além do Chrome; produção (não tocada).
- Próxima ação: aguardar o próximo bloco. Nada de Follow-up, Plantões ou dashboard integrado foi implementado.
