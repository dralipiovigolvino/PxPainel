# Progresso — Atualização 1

Estado: implementado em development, aguardando avaliação de funcionamento e aparência.

## Implementado

- CNPJ: abreviação obrigatória, preservando os cadastros existentes por preenchimento inicial a partir do nome.
- Plantões e Perícias: escolha explícita entre PF e CNPJ; com mais de um CNPJ, os botões usam as abreviações cadastradas.
- Plantões: atalhos de 12 h e 24 h, previsão por dia + “este mês/mês seguinte”, persistida em tipos, recorrências e ocorrências.
- Plantões: resumo acima do calendário, líquido estimado após imposto, lista mensal agrupada por local/tipo e ação de marcar pagamento na linha do plantão.
- Plantões: Recebimentos, Recorrências e Locais/Tipos consolidados na seção Organização. As URLs antigas continuam acessíveis para não quebrar links existentes.
- Perícias: resumo financeiro acima da agenda e calendário mensal com horário e empresa.
- Follow-up: ação “Adicionar atendimento”, escolhendo paciente existente ou criando paciente e consulta na mesma transação.
- Dashboard: somente agenda de Follow-up, Plantões e Perícias, sem consultas ou resumos financeiros.
- Migration `0021_atualizacao_1.sql` aplicada apenas no branch development.

## Decisões de compatibilidade

- Registros existentes mantêm “mês seguinte”, que era a regra anterior.
- Alterar a regra padrão de um tipo continua sem reescrever plantões históricos silenciosamente.
- O seletor mostra “CNPJ” quando há apenas um cadastro e a abreviação quando há mais de um.
- Ao usar 12 h ou 24 h sem horário inicial, o formulário parte de 08:00; com início preenchido, calcula a partir dele.
- A lista de Plantões agrupa por local; quando o local não está informado, usa o nome do tipo.

## Verificações executadas

- TypeScript, ESLint e build completo: aprovados.
- Testes unitários: 31 arquivos, 286 testes aprovados.
- Integração completa: 16 arquivos e 120 testes aprovados; 1 teste já marcado como ignorado pelo projeto. A execução usa o banco development real e confirmou persistência, edição, cálculos, ausência de dupla contagem e isolamento.
- Integração direcionada: CNPJ, Plantões, Perícias e Follow-up; Plantões ficou com 12/12 e o fluxo atômico de atendimento do Follow-up com 6/6 testes aprovados.
- RLS: suíte completa aprovada, incluindo isolamento entre usuários, permissões, CNPJ, Plantões, Perícias e Follow-up.
- E2E dirigido: todos os 20 controles aprovados, cobrindo os elementos pedidos, ausência de informações financeiras no Dashboard, console limpo e ausência de rolagem horizontal em 375 px e 1280 px nas seis telas afetadas.
- Revisão visual direcionada: 20/20 controles aprovados em 375 px e 1280 px, com formulários, estados principais, console limpo e sem rolagem horizontal nas seis telas afetadas.
- Revisão visual geral: as telas alteradas também passaram em 375 px, 768 px e 1280 px, tanto vazias quanto com dados. O bloco completo de diálogos ficou inconclusivo porque o runner perdeu a hidratação durante a execução extensa; o roteiro foi reforçado para aguardar o layout autenticado e repetir a abertura. A última execução ainda encontrou alvos menores que 24 px em telas antigas de Finanças, fora do escopo desta atualização, e terminou com timeout do navegador. Esses pontos não foram alterados silenciosamente.
