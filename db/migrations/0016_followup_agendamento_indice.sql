-- 0016: Follow-up — a unicidade da próxima consulta em aberto passa a ser por (usuário, paciente).
-- Com o índice só por paciente, uma tentativa de outra conta de agendar para um paciente alheio
-- falhava por unicidade (antes da chave estrangeira) quando havia agendamento em aberto, revelando
-- esse fato pelo tipo do erro. Agora essa tentativa é sempre recusada pela chave estrangeira composta.

drop index public.fu_appointments_patient_open_key;
create unique index fu_appointments_patient_open_key on public.fu_appointments (user_id, patient_id) where status = 'agendada';
