-- Caudal: créditos de consumo mensual definidos comercialmente para el cliente.
-- Es opcional: los registros existentes quedan sin caudal definido (null).
alter table public.onboarding_configs
add column if not exists flow_credits integer;

alter table public.onboarding_configs
drop constraint if exists onboarding_configs_flow_credits_check;

alter table public.onboarding_configs
add constraint onboarding_configs_flow_credits_check
check (flow_credits is null or flow_credits >= 0);

alter table public.sales_proposals
add column if not exists flow_credits integer;

alter table public.sales_proposals
drop constraint if exists sales_proposals_flow_credits_check;

alter table public.sales_proposals
add constraint sales_proposals_flow_credits_check
check (flow_credits is null or flow_credits >= 0);
