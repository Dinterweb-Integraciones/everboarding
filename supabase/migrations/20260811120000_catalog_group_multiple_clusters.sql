create table if not exists public.credit_catalog_group_clusters (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_catalog_group_cluster_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.credit_catalog_groups(id) on delete cascade,
  cluster_id uuid not null references public.credit_catalog_group_clusters(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (group_id, cluster_id)
);

create unique index if not exists credit_catalog_group_clusters_label_unique_idx
on public.credit_catalog_group_clusters (lower(trim(label)));

create index if not exists credit_catalog_group_clusters_available_idx
on public.credit_catalog_group_clusters (is_active, sort_order, label);

create index if not exists credit_catalog_group_cluster_links_group_idx
on public.credit_catalog_group_cluster_links (group_id, sort_order);

create index if not exists credit_catalog_group_cluster_links_cluster_idx
on public.credit_catalog_group_cluster_links (cluster_id);

drop trigger if exists set_credit_catalog_group_clusters_updated_at on public.credit_catalog_group_clusters;
create trigger set_credit_catalog_group_clusters_updated_at
before update on public.credit_catalog_group_clusters
for each row execute function public.set_current_timestamp_updated_at();

alter table public.credit_catalog_group_clusters enable row level security;
alter table public.credit_catalog_group_cluster_links enable row level security;

drop policy if exists "catalog_group_clusters_read_authenticated" on public.credit_catalog_group_clusters;
drop policy if exists "catalog_group_clusters_manage_authenticated" on public.credit_catalog_group_clusters;
drop policy if exists "catalog_group_cluster_links_read_authenticated" on public.credit_catalog_group_cluster_links;
drop policy if exists "catalog_group_cluster_links_manage_authenticated" on public.credit_catalog_group_cluster_links;

create policy "catalog_group_clusters_read_authenticated"
on public.credit_catalog_group_clusters
for select
to authenticated
using (true);

create policy "catalog_group_clusters_manage_authenticated"
on public.credit_catalog_group_clusters
for all
to authenticated
using (true)
with check (true);

create policy "catalog_group_cluster_links_read_authenticated"
on public.credit_catalog_group_cluster_links
for select
to authenticated
using (true);

create policy "catalog_group_cluster_links_manage_authenticated"
on public.credit_catalog_group_cluster_links
for all
to authenticated
using (true)
with check (true);

-- Conserva los clusters guardados de todos los casos de uso identificados.
insert into public.credit_catalog_group_clusters (label, sort_order)
select distinct on (lower(trim(cluster)))
  trim(cluster),
  (row_number() over (order by lower(trim(cluster))) - 1)::integer
from public.credit_catalog_groups
where nullif(trim(use_case_code), '') is not null
  and nullif(trim(cluster), '') is not null
order by lower(trim(cluster)), trim(cluster)
on conflict do nothing;

insert into public.credit_catalog_group_cluster_links (group_id, cluster_id, sort_order)
select groups.id, clusters.id, 0
from public.credit_catalog_groups as groups
join public.credit_catalog_group_clusters as clusters
  on lower(trim(clusters.label)) = lower(trim(groups.cluster))
where nullif(trim(groups.use_case_code), '') is not null
  and nullif(trim(groups.cluster), '') is not null
on conflict (group_id, cluster_id) do nothing;
