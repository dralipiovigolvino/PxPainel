# Progresso — Follow-up (Etapas 8 e 9)

Arquivo de retomada. Não contém segredos, credenciais nem dados de pacientes (testes usam só nomes e textos fictícios).

## Contexto de partida (02/10/2026)

- Projeto Neon `young-unit-87419729`, branch **development** (confirmada pelo `.neon` e por `NEON_BRANCH`). A `production` não é tocada.
- Migrações aplicadas antes do bloco: 0001 a 0005. Etapas 1 a 7 concluídas (ver `docs/progresso-financas-avancadas.md`).
- Tabelas de Finanças vazias; nenhum paciente ou modelo cadastrado.

## Conferência pontual — projeções financeiras

**Status: corrigida e verificada.**

Achado no código:
- A geração atendia um mês futuro + 12 meses de projeção. A tela pede a geração até o fim da projeção; a ação gera tudo de uma vez, sem depender de visitar meses intermediários.
- Mas `ensureGeneratedThrough` limita o alvo a "fim do mês de hoje + 120 meses" (`clampTarget`). Além disso:
  - totais e projeções omitiam recorrências **sem aviso** (incompletos apresentados como completos);
  - `needsGeneration` continuava verdadeiro e a tela pedia geração a cada visita, sem efeito.

Correção (só este ponto):
- `generationWindow(needed, today)` (puro, `domain/recurrence.ts`) devolve o alvo limitado e se houve corte (`truncated`).
- As abas Mês e Visão geral usam esse alvo. Quando há corte, mostram "Incompleto: contas recorrentes só são geradas até DD/MM/AAAA…", e cada projeção que passa do limite é marcada como "Incompleta".

Testes direcionados:
- 3 unitários.
- `coverage.integration.test.ts` no Neon real:
  - mês +24 com projeção até +36: 37 ocorrências mensais, sem pendência de geração;
  - pedido de +140 meses: gera até +120, sinaliza o corte e não gera de novo.

## Etapa 8 — Pacientes, consultas e modelos

**Status: concluída e verificada no Neon real.**

Decisões:
- **Migração `0006_followup_cadastros`:** tabelas `fu_patients`, `fu_consultations`, `fu_templates` e `fu_template_steps`.
  - `user_id` em todas, RLS forçada, grants por coluna, `user_id` imutável.
  - FKs compostas: paciente → consulta, modelo → etapa.
- **Paciente:**
  - nome obrigatório (até 120); nomes iguais permitidos;
  - telefone opcional, guardado em E.164 (o banco confere o formato); aceita formatos brasileiro e internacional com mensagens de exemplo;
  - observação até 1000;
  - arquivar/restaurar; excluir só sem consultas (RESTRICT);
  - arquivar não cancela acompanhamentos e informa quantas etapas pendentes continuam.
- **Consulta** (várias por paciente):
  - data civil, retroativa permitida, futura recusada (formulário, servidor e gatilho do banco, que usa a data de São Paulo);
  - paciente arquivado não recebe consulta nova (gatilho);
  - o paciente da consulta não pode ser trocado (sem UPDATE em `patient_id`);
  - observação até 2000.
- **Modelos:**
  - nome único por usuário, descrição opcional; arquivar/restaurar; sem exclusão (a origem dos planos continua rastreável);
  - `version` sobe a cada edição; a edição substitui as etapas numa transação, com a linha travada;
  - etapas: intervalo de 0 a 3650 dias (documentado), único por modelo (no banco); mensagem até 2000 caracteres; ordem de exibição (`position`); 1 a 30 etapas;
  - nenhum intervalo fixo no código e nenhum modelo pré-criado (exemplos só como placeholder).
- **Mensagens:**
  - variáveis `{nome}`, `{data_consulta}` (DD/MM/AAAA) e `{dia_followup}` (D0, D7…);
  - variáveis desconhecidas apontadas no formulário e recusadas no servidor (nunca trocadas por vazio);
  - texto simples, exibido com quebras de linha preservadas (sem HTML);
  - prévia com dados de exemplo fictícios.
- **Privacidade:**
  - busca de pacientes só no navegador (nome sem acento ou telefone pelos dígitos), sem URL, servidor ou log;
  - URLs só com ids; título da página genérico;
  - erros registram só o código.
- **Sessão:** leituras de pacientes e modelos usam `requireVerifiedUser()`, que confirma a sessão no Neon Auth sem o cache de 60 s (memorizado por requisição). Gravações continuam com `requireFreshUser()`.
- **Telas:** abas Acompanhamentos, Pacientes, Modelos; página do paciente com identificação, aviso de arquivado, consultas (observação, correção de data).

Arquivos:
- `db/migrations/0006_followup_cadastros.sql`
- `src/modules/followup/`: `domain/` (phone, messages, schemas, search + testes), `data.ts`, `actions.ts`, `types.ts`, `components/` (followup-nav, patients-manager, patient-form-dialog, patient-detail, consultation-dialogs, templates-manager, template-form-dialog)
- `src/app/(app)/follow-up/` (page, pacientes, pacientes/[id], modelos)
- `src/lib/auth/session.ts` (`requireVerifiedUser`)
- `test/integration-helpers.ts` (`cleanupFollowup`), `cadastros.integration.test.ts`, `scripts/rls-check.mjs`, `scripts/e2e-followup.mjs`, `package.json` (`test:e2e:followup`)

Testes:
- Unitários: 156/156 (25 novos do Follow-up + 3 da conferência).
- Integração no Neon real: 5/5 de cadastros + 1 da conferência.
- RLS: 16 novos de Follow-up, todos passando.
- Navegador (`npm run test:e2e:followup -- etapa8`): 51/51, incluindo B com 404 e 375/768/1280 px.
- Lint, typecheck e build: OK.

Pendências: nenhuma bloqueante. Backup/restauração e entrega de e-mails continuam pendentes: **não usar dados reais de pacientes**.

## Etapa 9 — Geração e execução

**Status: concluída e verificada no Neon real.**

Decisões:
- **Migração `0007_followup_planos`:**
  - `fu_plans` (um por consulta);
  - `fu_steps` (etapas geradas);
  - `fu_events` (histórico, somente inclusão);
  - `request_id` em `fu_consultations` (duplo envio não cria outra consulta);
  - FKs compostas em todos os vínculos; sem DELETE para o app em planos, etapas e histórico.
- **Aplicar modelo:**
  - ao registrar a consulta (mesma transação) ou depois, numa consulta sem acompanhamento;
  - prévia com etapa, data e mensagem, calculada com as mesmas funções puras do servidor;
  - cópia do intervalo e do texto de cada etapa, mais o nome e a versão do modelo; a referência de origem é preservada;
  - idempotente por `request_id`; `UNIQUE (consultation_id)` impede um segundo plano (a corrida resulta em um sucesso e um "já tem acompanhamento");
  - modelo arquivado ou inválido desfaz a transação inteira (nem a consulta é gravada).
- **Datas:** dias corridos sobre datas civis (`addDays`), por exemplo D7 de 28/09 = 05/10. Atrasado é calculado: pendente com data prevista antes de hoje (São Paulo); hoje não está atrasado.
- **Substituir pendentes** (ação explícita, com prévia do servidor):
  - pendentes comuns → canceladas como "substituídas" (no histórico);
  - realizadas e pendentes personalizadas (remarcadas ou com texto ajustado) são mantidas;
  - nenhum intervalo já existente é recriado; índice parcial único no banco.
- **Corrigir a data da consulta** (prévia; só aplica após confirmar):
  - recalcula só as pendentes não remarcadas;
  - preserva realizadas (datas e realização) e remarcadas;
  - registra de/para e as exceções.
- **Remarcar uma etapa:** guarda a data original e a prevista; o rótulo D7 permanece; voltar à data original desfaz a marcação.
- **Status:**
  - pendente → realizado (instante do servidor, texto renderizado guardado, observação opcional) ou cancelado (motivo opcional);
  - desfazer realização com confirmação; o registro anterior (instante e texto) vai para o histórico;
  - cancelar acompanhamento cancela as pendentes e preserva realizadas;
  - cancelado é final (gatilhos do banco).
- **Mensagem e cópia:**
  - o texto exibido (renderizado) é o que será copiado; ajuste opcional só da etapa, sem mudar o modelo;
  - sucesso só depois da Clipboard API aceitar; na falha, aviso e texto selecionado para cópia manual;
  - copiar não conclui e registra só "mensagem copiada (não indica envio)";
  - nenhum envio, WhatsApp ou notificação.
- **Central (`/follow-up`):**
  - filtros Hoje, Atrasados, Próximos, Concluídos e Todos (com "Mostrar cancelados"), na URL só como códigos;
  - contadores sobre todos os registros, sem realizados nem cancelados;
  - ordenação por data prevista (concluídos: realização mais recente primeiro), desempate estável;
  - busca por paciente só no navegador;
  - sem paginação (uso pessoal): filtros e contadores operam sobre o conjunto completo.
- **Página do paciente:**
  - por consulta: modelo e versão copiada, etapas (pendentes, realizadas, canceladas ou substituídas), observações, remarcações e histórico legível;
  - aviso quando há mais de um acompanhamento ativo (uma consulta nova não encerra a anterior).
- **Diálogos das etapas** num provedor no nível da lista: quando a ação tira a etapa do filtro, o aviso de sucesso não se perde.
- **Sessão revogada:** em Server Components, o SDK tentava apagar os cookies e o Next recusava (erro 500). Esse caso agora vai para o login. Verificado:
  - sessão válida, com cache novo ou vencido: 200;
  - cópia de cookies após sair: 307 para o login, sem dados.

Arquivos:
- `db/migrations/0007_followup_planos.sql`
- `src/modules/followup/domain/plan.ts`, `history.ts` (+ `plan.test.ts`), `plans-data.ts`, `actions.ts`, `types.ts`
- `components/step-item.tsx`, `plan-dialogs.tsx`, `followup-central.tsx`, `patient-detail.tsx`, `consultation-dialogs.tsx`
- `src/app/(app)/follow-up/page.tsx`, `pacientes/[id]/page.tsx`
- `src/lib/auth/session.ts`
- `plans.integration.test.ts`, `scripts/rls-check.mjs`, `scripts/e2e-followup.mjs`, `docs/banco-de-dados.md` (seção Follow-up)

Testes:
- Unitários: 173/173 (17 de planos, datas, substituição, correção, status e central).
- Integração no Neon real: 10 de planos + 5 de cadastros + 1 da conferência. Suíte completa: 53/53 (+1 limpeza manual ignorada).
- RLS: 148/148 (16 de cadastros + 18 de planos, etapas e histórico).
- Navegador: Follow-up 106/106 (Etapa 8: 51; Etapa 9: 55), com cópia (sucesso e falha), sessão revogada, B com 404 e 375/768/1280 px. Estável em execuções repetidas.
- Regressão: autenticação 32/32; Finanças Etapas 4 e 7 60/60 (partes afetadas pela conferência).

Correções:
- Aviso de sucesso perdido quando a etapa saía do filtro → provedor de diálogos no nível da lista.
- Sessão revogada gerava erro 500 em páginas de pacientes → login.
- Cabeçalho do plano e linhas das etapas espremidos em 768 px → lado a lado só a partir de `lg`.
- Teste de integração da Etapa 4 tinha o horizonte fixado em "set/2027" e quebrou com a virada do mês → contagens derivadas de `horizonDate()`. Código de Finanças inalterado.

## Estado final do bloco

- Etapas 8 e 9 concluídas. Banco sem resíduos de teste.
- **Não usar dados reais de pacientes:** backup/restauração e entrega de e-mails continuam pendentes; o SDK de autenticação continua beta.
- Não verificado: leitores de tela reais; navegadores além do Chrome; volume grande de registros (sem paginação).
- Próxima ação: aguardar o próximo bloco. Plantões não foi iniciado.
