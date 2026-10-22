-- EXO · Control de producción
-- Ejecutar completo en Supabase: SQL Editor → New query → pegar → Run.

-- Catálogo de artículos
create table if not exists public.articulos (
  sku          text primary key,
  categoria    text not null,
  descripcion  text not null,
  actualizado  timestamptz not null default now()
);

-- Pedidos (las piezas y las fotos se guardan dentro de cada pedido)
create table if not exists public.pedidos (
  id             uuid primary key default gen_random_uuid(),
  nro            text not null,
  cliente        text not null,
  vendedor       text,
  responsable    text,
  observaciones  text,
  items          jsonb not null default '[]'::jsonb,
  fotos          jsonb not null default '[]'::jsonb,
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','produccion','terminado','anulado')),
  fecha          timestamptz not null default now(),
  actualizado    timestamptz,
  terminado_en   timestamptz,
  creado_por     text
);

-- El número de pedido no se puede repetir (sin importar mayúsculas ni espacios)
create unique index if not exists pedidos_nro_unico on public.pedidos (lower(btrim(nro)));
create index if not exists pedidos_fecha_idx on public.pedidos (fecha desc);

-- Permisos: solo los usuarios con sesión iniciada pueden usar las tablas.
-- Funciona tanto con "Exponer automáticamente nuevas tablas" activado como desactivado.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.articulos, public.pedidos to authenticated;
revoke all on public.articulos, public.pedidos from anon;

-- Seguridad: solo usuarios que iniciaron sesión pueden leer y escribir
alter table public.articulos enable row level security;
alter table public.pedidos   enable row level security;

drop policy if exists "articulos usuarios" on public.articulos;
create policy "articulos usuarios" on public.articulos
  for all to authenticated using (true) with check (true);

drop policy if exists "pedidos usuarios" on public.pedidos;
create policy "pedidos usuarios" on public.pedidos
  for all to authenticated using (true) with check (true);

-- Actualización en vivo entre dispositivos
do $$
begin
  begin alter publication supabase_realtime add table public.articulos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pedidos;   exception when duplicate_object then null; end;
end $$;

-- Fotos: carpeta privada, accesible solo con sesión iniciada
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

drop policy if exists "fotos ver" on storage.objects;
create policy "fotos ver" on storage.objects
  for select to authenticated using (bucket_id = 'fotos');

drop policy if exists "fotos subir" on storage.objects;
create policy "fotos subir" on storage.objects
  for insert to authenticated with check (bucket_id = 'fotos');

drop policy if exists "fotos borrar" on storage.objects;
create policy "fotos borrar" on storage.objects
  for delete to authenticated using (bucket_id = 'fotos');
