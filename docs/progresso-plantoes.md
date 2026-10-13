# Progresso — Plantões (Etapas 10 a 12)

Arquivo de retomada. Não contém segredos, credenciais nem dados pessoais (testes usam só nomes fictícios).

## Contexto de partida (02/10/2026)

- Projeto Neon `young-unit-87419729`, branch **development** (confirmada por `.neon` e `NEON_BRANCH`). A `production` não é tocada.
- Migrações aplicadas antes do bloco: 0001 a 0007. Finanças (Etapas 3 a 7) e Follow-up (8 e 9) concluídos.
- Plantões tinha só o calendário mensal da Etapa 1 (sem dados).

## Conferência pontual — Follow-up (substituição de D7)

**Status: verificada, sem correção necessária.**

Teste novo em `plans.integration.test.ts` (Neon real):
- Modelo original D1 + D7. D1 realizada, D7 pendente comum. Novo modelo D1, D7 (mensagem diferente), D15.
- Prévia: remove D7; mantém D1 realizada; inclui D7 (nova mensagem) e D15; não recria D1.
- Resultado:
  - D1 realizada preservada;
  - D7 antiga **cancelada como "substituída"** (fica no histórico);
  - D7 nova pendente com a mensagem atualizada, mesma data;
  - D15 criada.
- O índice único só vale para etapas **não canceladas**, então a D7 cancelada não impede a nova.
- D7 personalizada (texto ajustado) é mantida, listada como "mantida" na prévia e não é recriada.
- "Um intervalo já existente nunca é recriado" vale para intervalos **realizados ou personalizados**; pendentes comuns são substituídas. A frase do relatório anterior era ambígua; o comportamento está correto.

## Etapa 10 — Tipos e calendário

**Status: concluída e verificada no Neon real.**

Decisões:
- **Migração `0008_plantoes_tipos`:** `pl_types`, `pl_shifts` (ocorrências) e `pl_events` (histórico, somente inclusão).
  - O histórico sobrevive à exclusão da ocorrência (`ON DELETE SET NULL (shift_id)`).
  - RLS forçada, grants por coluna, FK composta tipo → ocorrência, tipo da ocorrência imutável.
- **Tipo:**
  - nome único por usuário, local opcional, valor padrão positivo (centavos, mesmo parser e limites de Finanças), cor `#rrggbb`;
  - horários opcionais e observação padrão; arquivar, restaurar e excluir só sem vínculos;
  - nenhum tipo pré-cadastrado.
- **Horários:**
  - ambos vazios, ou início + fim + "termina no dia seguinte" explícito;
  - no mesmo dia, fim > início; no dia seguinte, fim ≤ início (até 24 h);
  - 07:00 → 07:00 do dia seguinte = 24 h, nunca duração zero;
  - mesma regra no formulário, no servidor e no banco (CHECK);
  - prévia "07:00 → 19:00 (12 h)".
- **Ocorrência:**
  - copia valor, horários e observação do tipo (editáveis só nela); editar o tipo não muda as existentes;
  - aparece no dia em que começa; os detalhes mostram término e data de término;
  - criação idempotente por `request_id`;
  - sobreposição (inclusive com o noturno da véspera) avisa e pede confirmação, sem bloquear;
  - cancelar mantém a ocorrência (fora do calendário padrão; filtro "Mostrar cancelados"); restaurar volta a agendado;
  - excluir só se agendado.
- **Calendário:**
  - reaproveita o `MonthCalendar` da Etapa 1: domingo primeiro, hoje destacado, mês na URL;
  - cada dia mostra só o número e uma bolinha por ocorrência, na cor do tipo;
  - bolinha com contorno discreto quando há observação ou troca; cancelada aparece vazada;
  - alvo de toque de 28 px; nome acessível "Plantão {tipo} em DD/MM/AAAA" + situação e indicadores; foco por teclado;
  - muitas bolinhas quebram linha, sem sobrepor;
  - legenda recolhível;
  - clicar no número do dia abre "Novo plantão" com a data.
- **Detalhes:** nome, local, data e dia da semana, horário e término, valor, situação, recebimento, origem, observação, histórico e ações.

Arquivos:
- `db/migrations/0008_plantoes_tipos.sql`
- `src/modules/plantoes/`:
  - `domain/` (hours, schemas, history + `hours.test.ts`)
  - `data.ts`, `actions.ts`, `types.ts`
  - `components/` (plantoes-nav, types-manager, hours-fields, shift-form, shift-details, plantoes-view, month-calendar ampliado)
- `src/app/(app)/plantoes/page.tsx`, `src/app/(app)/plantoes/tipos/page.tsx`
- `tipos.integration.test.ts`, `test/integration-helpers.ts` (`cleanupPlantoes`), `scripts/rls-check.mjs`, `scripts/e2e-plantoes.mjs`, `package.json` (`test:e2e:plantoes`)

Testes:
- Unitários: 10 novos (horários, 12 h/24 h, virada de ano, sobreposição, validações).
- Integração no Neon real: 6/6.
- RLS: 14 novos (162/162 no total).
- Navegador: 46/46, incluindo:
  - dias só com número e bolinhas; cor do tipo;
  - detalhes por teclado; duplo clique;
  - dois plantões no dia; sobreposição confirmada;
  - 6 plantões no dia sem sobreposição em 375/768/1280;
  - cancelados filtrados; tipo arquivado;
  - B sem acesso.

Correção durante a etapa: o teste de teclado enviava Enter sem o caractere (`text: "\r"`), ajustado no script.

## Etapa 11 — Recorrências e trocas

**Status: concluída e verificada no Neon real.**

Decisões:
- **Migração `0009_plantoes_series`:**
  - `pl_series`: dias da semana em máscara, a cada 1–12 semanas, data inicial e final, valores e horários copiados do tipo, `generated_until`, suspensão;
  - `pl_series_exceptions`;
  - ocorrências ganham `series_id` + `original_date` (únicos por série; a data original é imutável), `is_override` e `moved_at` (instante gravado pelo banco quando a data muda);
  - FKs compostas tipo → série → ocorrência e série → exceção;
  - sem DELETE nem alteração de regra no lugar (editar = dividir).
- **Regra semanal (pura):** âncora no domingo da semana da data inicial. "A cada 2 semanas" não depende do mês exibido nem da janela consultada (testado).
- **Geração:**
  - inicial até o horizonte (mês de hoje + 12);
  - meses mais distantes: a tela consulta (somente leitura) e o navegador chama uma ação autenticada explícita, nunca na renderização ou no prefetch;
  - idempotente (`UNIQUE` série + data original, `ON CONFLICT DO NOTHING`) e serializada (`FOR UPDATE` nas séries);
  - limite de segurança: 120 meses (mesma regra pura de Finanças); além dele, o calendário avisa "Incompleto".
- **Exceções:**
  - excluir uma ocorrência recorrente grava uma exceção (não volta);
  - cancelar mantém a linha (não duplica);
  - movida guarda a data original (não reaparece).
- **Edição da série** ("Somente este" = editar a ocorrência; "Este e os próximos" = a partir da data original; "Futuras" = a partir de hoje):
  - prévia com quantidade, período e preservados;
  - divisão numa transação: encerra a antiga, remove só as substituíveis (agendadas, não alteradas, não movidas; recebidas entram na Etapa 12), cria a nova, reatribui preservadas cujas datas existem na nova regra (sem duplicar), copia exceções e gera.
- **Encerrar** com prévia; **retomar** suspensa com data (o intervalo suspenso não é preenchido).
- **Arquivar tipo com recorrência ativa:** pede confirmação e suspende as séries; ocorrências e pagamentos ficam; restaurar não retoma.
- **Mover / troca:**
  - formulário (teclado e celular) e arrastar e soltar;
  - mostra data antiga e nova; mesmo dia não é aceito;
  - recorrente pergunta o alcance (padrão "Somente este"), com observação ("Troca com Fulano");
  - "Somente este" mantém o id e a data original; o histórico registra de/para, observação e instante;
  - "Este e os próximos/futuras" desloca os dias da semana da série (até 6 dias), com prévia;
  - troca entre pessoas não é automatizada.
- **Arraste** (sem biblioteca, eventos de ponteiro):
  - mouse começa após 6 px (clique abre os detalhes);
  - toque exige pressionar ~350 ms (deslizar antes disso é rolagem);
  - durante o toque, a rolagem é bloqueada só enquanto arrasta;
  - fantasma e dia de destino destacado; Esc ou soltar fora cancela;
  - nada muda antes de confirmar e gravar; a falha mostra erro e a bolinha fica onde estava.

Arquivos:
- `db/migrations/0009_plantoes_series.sql`
- `domain/recurrence.ts` (+ testes), `series-data.ts`, `actions.ts`, `data.ts` (exceção ao excluir)
- `components/`: series-form, series-manager, move-form, use-shift-drag, pl-generation-sync, plantoes-view, types-manager (confirmação)
- `app/(app)/plantoes/recorrencias/page.tsx`
- `series.integration.test.ts`

Testes:
- Unitários: 6 da recorrência + 2 do formulário.
- Integração no Neon real: 9/9, incluindo:
  - toda quinta; alternadas; virada de ano;
  - geração repetida e concorrente;
  - mover entre meses; excluir e cancelar não recriam;
  - dividir com exceções e preservadas; encerrar; arquivar, suspender e retomar;
  - mover a série; isolamento.
- RLS: 15 novos (177/177).
- Navegador: 43/43, incluindo:
  - mês além do horizonte gera; além do limite avisa;
  - mover por formulário entre meses; arraste com mouse (clique × arraste, cancelar, falha de gravação, confirmar);
  - toque emulado (deslizar não arrasta; segurar arrasta);
  - exclusão sem recriação; alterar recorrência com prévia; mover a série;
  - arquivar e suspender; B sem acesso.

Correção durante a etapa: o regex do intervalo em semanas perdeu o escape (`/^d{1,2}$/`) num patch, e a criação de recorrências falhava pela interface. Corrigido, com testes unitários do esquema da recorrência para cobrir o caso.

## Etapa 12 — Valores e recebimentos

**Status: concluída e verificada no Neon real.**

Decisões:
- **Migração `0010_plantoes_recebimentos`:**
  - situação do plantão `agendado | realizado | cancelado` + `done_at`;
  - situação financeira `received_on` + `received_cents`, independentes entre si.
- **Restrições do banco:**
  - realizado ⇔ instante de realização;
  - recebido ⇔ valor recebido = valor da ocorrência (o gatilho define o valor; o app só grava a data);
  - cancelado não pode estar recebido.
- **Gatilhos para o papel do app:**
  - data do recebimento até hoje (São Paulo);
  - recebido não muda valor nem cancela;
  - realizado → cancelado não é direto (desfazer a realização antes, ação explícita);
  - realizados e recebidos não são excluídos.
- **Realização manual:** data passada não realiza sozinha. Agendados passados aparecem em "A confirmar", fora da grade (de qualquer mês), e no filtro "A confirmar".
- **Recebimento:**
  - integral, com data obrigatória até hoje;
  - pode ser antecipado: não marca realização; agendado recebido continua "Agendado";
  - desfazer pede confirmação e limpa a data; o registro anterior (data e valor) fica no histórico.
- **Edições da série** preservam também os recebidos (regra "substituível" agora exclui `received_on`).
- **Totais** (`domain/totals.ts`, puro; competência = mês em que o plantão começa; cancelados fora):
  - Programado = agendados + realizados = Recebido dos plantões do mês + A receber;
  - A receber = realizados a receber + agendados a receber (inclui futuros);
  - Realizado é indicador sobreposto (rotulado "não some").
- **Recebido no mês:** seção separada, pela data real do recebimento (outra pergunta, rotulada).
- **Filtros na URL:** tipo, situação (inclui "A confirmar" e "Cancelados") e pagamento. Totais e calendário usam o mesmo recorte do conjunto completo do mês (sem paginação), com o escopo rotulado.
- Sem pagamentos parciais, impostos, repasses ou lançamentos automáticos em Finanças.

Arquivos:
- `db/migrations/0010_plantoes_recebimentos.sql`
- `domain/totals.ts` (+ `totals.test.ts`), `data.ts` (realização, recebimento, recebido no período, a confirmar), `actions.ts`, `series-data.ts`
- `components/`: receive-form, shift-details, plantoes-view
- `src/app/(app)/plantoes/page.tsx`
- `recebimentos.integration.test.ts`

Testes:
- Unitários: totais do cenário de referência, identidades entre os totais, recebimento antecipado e filtros.
- Integração no Neon real: 6/6, incluindo:
  - cenário de referência em meses passados (2.300 / 1.800 / 1.000 / 1.300 / 800; recebido no mês 0 e no seguinte 1.000);
  - realização manual; antecipado; data futura recusada;
  - proteções (app e banco); desfazer recebimento;
  - série preserva recebido; isolamento.
- RLS: 9 novos (186/186).
- Navegador: 29/29, incluindo:
  - cenário de referência montado pela interface e totais conferidos na tela;
  - filtros; "A confirmar"; proteções; desfazer recebimento com histórico; antecipado;
  - 375/768/1280; B sem acesso.

## Retomada após o desligamento (03/10/2026)

- O notebook desligou durante a bateria completa de Plantões. O token do Claude Code falhou depois.
- Estado conferido:
  - nenhum servidor, teste ou Chrome de teste ativo; porta 3000 livre;
  - migrações 0001–0010 registradas em `app_private.schema_migrations` (nada reaplicado);
  - código intacto: lint, typecheck e 191 testes unitários passaram de novo.
- Resíduos da rodada interrompida: só nas contas de teste (6 tipos `[teste-…]`, 803 ocorrências etc.). A pré-limpeza do roteiro removeu 840 registros.
- Antes do desligamento, uma execução da bateria completa travou várias horas. Causa provável: uma chamada ao navegador sem resposta.
  - Correção: `scripts/lib/browser.mjs` limita cada chamada ao navegador a 60 s; um teste travado agora falha em vez de esperar indefinidamente.
  - Também corrigido o cálculo de posições do arraste no roteiro: uma única rolagem e as duas posições lidas juntas.
- Executado agora:
  - Plantões 10–12 juntos: 118/118;
  - integração: 73/75 na primeira rodada; as 2 falhas foram queda da conexão WebSocket com o Neon no meio do teste, sem asserção falhando; as duas suítes reexecutadas passaram (21/21), total 75/75 (+1 limpeza manual ignorada);
  - RLS 186/186; autenticação 32/32; Follow-up 106/106 (regressão do auxiliar de navegador);
  - Etapa 12 reexecutada após o ajuste final de layout: 29/29.
- Ajuste visual: os filtros do calendário cortavam o texto a 768 px; agora ficam lado a lado só a partir de `lg`. Medido: o texto cabe em 375/768/1280, sem rolagem horizontal.

## Estado final do bloco

- Etapas 10, 11 e 12 concluídas. Banco sem resíduos: 0 linhas em Plantões, Follow-up e Finanças.
- Pendências conhecidas, não resolvidas:
  - backup/restauração;
  - entrega de e-mails;
  - revisão do SDK de autenticação (beta) antes da produção;
  - senha temporária (arquivo mantido).
- Não verificado:
  - aparelho físico de toque (só toque emulado no Chrome);
  - leitores de tela reais;
  - outros navegadores;
  - volume grande (sem paginação).
- Arquivo solto `NUL` na raiz (captura PNG de 28/09 salva com nome inválido): sem dados sensíveis, mantido para decisão do usuário.
- Próxima ação: aguardar o próximo bloco. Dashboard integrado não iniciado.
