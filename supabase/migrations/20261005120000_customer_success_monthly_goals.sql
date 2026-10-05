-- Meta mensual de créditos completados por Customer Success. Una fila por CS y mes calendario;
-- `month` siempre es el primer día del mes. Admin y superadmin las administran desde /cs/metas;
-- el informe de Informes compara contra ellas los créditos completados en el mes.
create table if not exists public.customer_success_monthly_goals (
  customer_success_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  goal_credits integer not null check (goal_credits >= 0),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (customer_success_id, month)
);

alter table public.customer_success_monthly_goals enable row level security;

drop policy if exists "customer_success_monthly_goals_select_own_or_admin" on public.customer_success_monthly_goals;
create policy "customer_success_monthly_goals_select_own_or_admin"
on public.customer_success_monthly_goals for select to authenticated
using (
  customer_success_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role in ('admin', 'superadmin')
  )
);

drop policy if exists "customer_success_monthly_goals_manage_admins" on public.customer_success_monthly_goals;
create policy "customer_success_monthly_goals_manage_admins"
on public.customer_success_monthly_goals for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_active = true
      and platform_role in ('admin', 'superadmin')
  )
);
