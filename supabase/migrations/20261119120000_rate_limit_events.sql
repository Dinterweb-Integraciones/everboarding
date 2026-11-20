-- Límite de peticiones para endpoints sin sesión (enlaces de listas de precios, recomendaciones con
-- IA). Cada petición permitida deja una fila en su "bucket" (p. ej. link:<id>:create); se rechaza
-- cuando el bucket ya tiene el máximo de filas dentro de la ventana. Vive en la base para que el
-- límite se cumpla entre instancias del servidor.
create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists rate_limit_events_bucket_created_idx
  on public.rate_limit_events (bucket, created_at);

-- Solo se usa desde el servidor con la service role.
alter table public.rate_limit_events enable row level security;

-- Registra la petición si el bucket tiene cupo y devuelve si se permitió. El advisory lock serializa
-- las peticiones simultáneas del mismo bucket para que no se pasen del máximo.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := timezone('utc', now()) - make_interval(secs => p_window_seconds);
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));

  delete from public.rate_limit_events
  where bucket = p_bucket and created_at < v_window_start;

  select count(*) into v_count
  from public.rate_limit_events
  where bucket = p_bucket;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (bucket) values (p_bucket);
  return true;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
