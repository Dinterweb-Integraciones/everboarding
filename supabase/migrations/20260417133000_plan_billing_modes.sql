-- Separates package duration from Stripe billing mode.
-- A monthly plan can be a recurring membership, while any period can also be sold as a one-time package.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'custom_plan_billing_mode'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.custom_plan_billing_mode as enum ('subscription', 'one_time');
  end if;
end;
$$;

alter table public.onboarding_configs
add column if not exists custom_plan_billing_mode public.custom_plan_billing_mode not null default 'subscription';

update public.onboarding_configs
set custom_plan_billing_mode = 'one_time'
where custom_plan_type = 'proyecto'
  and custom_plan_billing_mode = 'subscription';
