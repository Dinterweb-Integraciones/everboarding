alter table public.onboarding_configs
add column if not exists north_star_lifecycle_status text not null default 'inactive'
  check (north_star_lifecycle_status in ('active', 'inactive', 'fulfilled'));

update public.onboarding_configs
set north_star_lifecycle_status = case
  when north_star_status = 'completed' and nullif(btrim(coalesce(north_star_text, '')), '') is not null then 'active'
  else 'inactive'
end
where north_star_lifecycle_status = 'inactive';
